import express from 'express'
import cookieParser from 'cookie-parser'
import favicon from 'serve-favicon'
import { join } from 'path'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import Debug from 'debug'
import crypto from 'crypto'
import Snowflake from 'snowflake-util'
import { fromBase64 } from './helpers.js'

import bot from './bot.js'

import DiscordOauth2 from 'discord-oauth2'
import { nextTick } from 'process'
const oauth = new DiscordOauth2({
  clientId: process.env.OAUTH2_CLIENT_ID,
  clientSecret: process.env.OAUTH2_CLIENT_SECRET,
  redirectUri: process.env.OAUTH2_CALLBACK
})

const __dirname = dirname(fileURLToPath(import.meta.url))
const snowflake = new Snowflake()

const debug = Debug('postie:http')
const app = express()

// Favicon & Static Files
app.use(cookieParser())
app.use(express.json())
app.use(favicon(join(__dirname, '/public/favicon.ico')))

// Log http requests to the invite site
function logReq (request, status) {
  const { rawHeaders, httpVersion, method, url } = request
  const ip =
    request.headers['x-forwarded-for'] || request.connection.remoteAddress
  debug(ip, ' - ', `"${method} ${url} HTTP/${httpVersion}" ${status}`)
}

// ==============================
// ======= Authentication =======
// ==============================

// https://discord.com/developers/docs/topics/oauth2#oauth2
app.use(async function (request, response, next) {
  // Handle the authentication logic
  var p = request.query
  // If we are coming back from an actual authentication vs a bot invite
  if (request.path == '/' && Boolean(p.state) && Boolean(p.code)) {
    // Exchange the code for the user's access token
    try {
      var access_object = await oauth.tokenRequest({
        code: p.code,
        scope: 'identify email guilds',
        grantType: 'authorization_code'
      })
      await bot.db.read()
      bot.db.set(`authTokens.${p.state}`, access_object)
      bot.db.set(`authTokens.${p.state}.timestamp`, Date.now())
      await bot.db.write()
      debug('exchanged for & stored the auth tokenm also')
      response.cookie('authState', p.state, {
        maxAge: access_object.expires_in * 1000,
        httpOnly: true
      })
      response.cookie('isLoggedIn', true, {
        maxAge: access_object.expires_in * 1000,
        httpOnly: false
      })
      debug('set user cookie')
    } catch (error) {
      debug('requesting access_token from discord went wrong: ', error)
    }

    return response.redirect(request.originalUrl.split('?').shift())
  }

  // Setup & Manage cookies for other middlewares
  var cookie = request.cookies.authState
  if (cookie) {
    // Retrieve access_token from DB
    await bot.db.read()
    var token = bot.db.get(`authTokens.${cookie}.access_token`)
    if (!token) {
      response.clearCookie('authState')
      response.clearCookie('isLoggedIn')
    }
    request.access_token = token
  }

  // Logout
  if (request.path == '/logout' && request.access_token) {
    // Client Cookies
    response.clearCookie('authState')
    response.clearCookie('isLoggedIn')
    // Server Token & Database
    const credentials = Buffer.from(
      `${process.env.OAUTH2_CLIENT_ID}:${process.env.OAUTH2_CLIENT_SECRET}`
    ).toString('base64')

    var token = bot.db.get(`authTokens.${cookie}`)

    if (token) {
      oauth.revokeToken(token.access_token, credentials).then(debug)

      await bot.db.read()
      delete bot.db.data.authTokens[cookie]
      await bot.db.write()

      debug('logged user out')
    }
  }

  next()
})

// Handler for expiring tokens
var bufferMiliseconds = 1000 * 60 * 60 * 24 // one day in seconds

async function checkTokenExpiry () {
  // find tokens expiring with the next day and a half
  await bot.db.read()
  var authStates = Object.keys(bot.db.data.authTokens)
  // Get keys for tokens soon to expire
  var expiringTokenKeys = authStates.filter(s => {
    var o = bot.db.data.authTokens[s]
    return (
      o.timestamp + o.expires_in * 1000 < Date.now() + bufferMiliseconds * 1.5
    )
  })
  // Regenerate them
  expiringTokenKeys.forEach(async key => {
    debug('Regenerating expiring token: ' + key)
    await bot.db.read()
    var refreshToken = bot.db.get(`authTokens.${key}.refresh_token`)
    bot.db.set(
      `authTokens.${key}`,
      await oauth.tokenRequest({
        refreshToken,
        grantType: 'refresh_token'
      })
    )
    bot.db.set(`authTokens.${key}.timestamp`, Date.now())
    await bot.db.write()
  })
}

// Run checks now and every day
checkTokenExpiry()
setInterval(checkTokenExpiry, bufferMiliseconds)

// ==============================
// ======= Route Handlers =======
// ==============================

app.get('/authurl', function (request, response) {
  var authUrl = oauth.generateAuthUrl({
    scope: ['identify email guilds'],
    response_type: 'code',
    prompt: 'none', // 'consent' // to have a discord prompt
    state: crypto.randomBytes(16).toString('hex')
  })
  response.redirect(authUrl)
})

app.get('/inviteurl', function (request, response) {
  var authUrl = oauth.generateAuthUrl({
    scope: ['bot'],
    permissions: 2146958591
  })
  response.redirect(authUrl)
})

// ==============================
// ===== Data Get Handlers ======
// ==============================

app.get('/user', async function (request, response) {
  if (request.access_token)
    response.send(await oauth.getUser(request.access_token))
  else response.send(request.cookies)
})

// Guilds the user and the bot are both in
app.get('/guilds', async function (request, response) {
  if (request.access_token) {
    var userGuilds = await oauth.getUserGuilds(request.access_token)
    var botGuildIds = bot.guilds.map(g => g.id)

    var guilds = userGuilds
      .filter(g => botGuildIds.includes(g.id))
      .sort((a, b) => {
        if (a.name < b.name || (!Boolean(a.owner) && Boolean(b.owner))) {
          return -1
        }
        if (a.name > b.name || (Boolean(a.owner) && !Boolean(b.owner))) {
          return 1
        }
        return 0
      })

    response.send(guilds)
  } else response.send(request.cookies)
})

app.get('/roles/:guildId', async function (request, response) {
  var { guildId } = request.params
  try {
    if (guildId) {
      var roles = bot.guilds.get(guildId).roles.filter(r => !r.managed)
      response.send(roles)
      return
    }
  } catch (error) {
    debug('guild roles fetch error: ', error)
  }
  response.send([])
})

app.get('/channels/:guildId', async function (request, response) {
  var { guildId } = request.params
  try {
    if (guildId) {
      // https://discord.com/developers/docs/resources/channel#channel-object-channel-types
      var channels = bot.guilds
        .get(guildId)
        .channels.filter(c => c.type == 0)
        .sort((a, b) => {
          var atime = snowflake.deconstruct(
            a.lastMessageID ? a.lastMessageID : a.id
          ).timestamp
          var btime = snowflake.deconstruct(
            b.lastMessageID ? b.lastMessageID : a.id
          ).timestamp
          if (atime > btime) {
            return -1
          }
          if (atime < btime) {
            return 1
          }
          return 0
        })
      response.send(channels)
      return
    }
  } catch (error) {
    debug('guild channels fetch error: ', error)
  }
  response.send([])
})

app.get('/emojis/:guildId', async function (request, response) {
  var { guildId } = request.params
  try {
    if (guildId) {
      // https://discord.com/developers/docs/resources/channel#channel-object-channel-types
      var emojis = bot.guilds.get(guildId).emojis
      response.send(emojis)
      return
    }
  } catch (error) {
    debug('guild emojis fetch error: ', error)
  }
  response.send([])
})

app.get('/botmasters/:guildId', async function (request, response) {
  var { guildId } = request.params
  try {
    if (guildId) {
      await bot.db.read()
      var masters = bot.db.get(`guilds.${guildId}.botMasters`)
      response.send(masters ? masters : {})
      return
    }
  } catch (error) {
    debug('guild botmasters fetch error: ', error)
  }
  response.send([])
})

// ==============================
// ===== Data Post Handlers =====
// ==============================

app.post('/botmasters', async function (request, response) {
  var config = request.body
  var guildId = config.guild

  try {
    if (guildId) {
      await bot.db.read()
      var masters = bot.db.get(`guilds.${guildId}.botMasters`)
      masters = masters ? masters : {}

      if (config.mode == 'add') {
        masters[config.roleId] = config.role
      } else if (config.mode == 'remove') {
        delete bot.db.data.guilds[guildId].botMasters[config.roleId]
      }

      // Update DB with the correct data
      bot.db.set(`guilds.${guildId}.botMasters`, masters)
      await bot.db.write()

      response.send('success')
      return
    }
  } catch (error) {
    response.send('error' + error)
    return
  }
  response.send('unfinished')
})

app.post('/createReactionMessage', async function (request, response) {
  var config = request.body
  var guildId = config.guild

  try {
    if (guildId) {
      // Create message and react to it
      var roleMessage = await bot.createMessage(config.channel, config.message)
      debug('created new reaction roles messagee: ' + roleMessage.id)

      Object.keys(config.reactionRoles).forEach(r =>
        roleMessage.addReaction(fromBase64(r))
      )

      // Update DB with the correct data
      await bot.db.read()

      bot.db.set(
        `guilds.${guildId}.reactionMessages.${roleMessage.id}`,
        config.reactionRoles
      )
      await bot.db.write()

      response.send('success')
      return
    }
  } catch (error) {
    response.send('error' + error)
    return
  }
  response.send('unfinished')
})

// ==============================
// ===== CatchAll Handlers ======
// ==============================

app.use(express.static(join(__dirname, 'public')))

app.get('*', function (request, response) {
  response.status(301)
  logReq(request, response.statusCode)
  response.redirect('/')
})

let listener = app.listen(process.env.PORT, function () {
  debug('invite site listening on ' + listener.address().port)
})

// We don't need any exports since everything is handled here
export default {}
