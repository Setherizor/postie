import request from 'request'
import ytdl from 'discord-ytdl-core'
import Debug from 'debug'
const debug = Debug('postie:module')

function enable (bot) {
  debug('Default Mode Ready!')

  // Request Function
  const post = (payload, url, callback) => {
    request.post(url, { json: { body: payload } }, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        debug('post response:', body)
        callback(body)
      }
    })
  }

  async function getVcConnection (msg, create = false) {
    const guild = bot.guilds.get(msg.guildID)
    var connection = bot.voiceConnections.find(c => c.id == msg.guildID)

    if (!connection && create) {
      const vcId = msg.member.voiceState.channelID
      if (!vcId) {
        throw new Error('notInVC')
        return
      }
      connection = await guild.channels.get(vcId).join()
      await bot.db.read()
      connection.setVolume(bot.db.data.config.volume || 0.01)
      connection.on('end', () => debug('stream ended'))
      connection.on('error', e => debug('stream error: ' + e))
      connection.on('userDisconnect', userId => {
        debug('user disconnected from VC: ' + userId)
      })
    }

    return connection
  }

  bot.registerCommand(
    'play',
    async (msg, args) => {
      if (
        args[0] == undefined ||
        !args[0].includes('youtu') ||
        (args[1] && !args[1].includes(':'))
      ) {
        bot.tmpResponse(
          msg,
          'Please pass in a **youtube video url** and optionally a starting timestamp like `1:33`',
          5000
        )
        return
      }

      const strToSec = x => {
        if (x == undefined || x == null) return undefined
        var parts = x.split(':').map(x => parseInt(x))
        return parts[0] * 60 + parts[1]
      }

      try {
        var connection = await getVcConnection(msg, true)
        if (connection.playing) connection.stopPlaying()

        // use argument or included time
        var seek = strToSec(args[1])
        if (seek == undefined) {
          seek = args[0].includes('t=')
            ? parseInt(args[0].split('t=').pop())
            : undefined
        }

        bot.tmpResponse(
          msg,
          ':musical_note: New video being played :thumbsup:',
          10000
        )

        connection.play(
          ytdl(args[0], {
            seek,
            quality: 'highestaudio',
            filter: 'audioonly',
            fmt: 'opus',
            encoderArgs: ['-af', 'bass=g=5'] // 5 is normal
          }),
          {
            inlineVolume: true,
            voiceDataTimeout: -1
          }
        )

        if (connection.paused) connection.resume()
      } catch (e) {
        if (e.message == 'notInVC') {
          bot.tmpResponse(
            msg,
            'You are not currently in any voice channels :angry:',
            5000
          )
        } else {
          debug('audio playback error', e)
          bot.tmpResponse(msg, '**VoiceConnection Error**', 5000)
        }
      }
    },
    {
      description: 'play audio from youtube',
      fullDescription:
        'Will attempt to play audio from youtube :smile:, start time is of the format `1:30`',
      deleteCommand: false
    }
  )

  bot.registerCommand(
    'stop',
    async (msg, args) => {
      try {
        var connection = await getVcConnection(msg, false)
        if (connection) connection.stopPlaying()
      } catch (e) {
        debug('audio stop error: ' + e)
        bot.tmpResponse(msg, '**autio stop error**', 5000)
      }
    },
    {
      description: 'stop current audio',
      fullDescription: 'will completely stop current audio'
    }
  )

  bot.registerCommand(
    'toggleaudio',
    async (msg, args) => {
      try {
        var connection = await getVcConnection(msg, false)
        if (connection && !connection.paused) connection.pause()
        else if (connection && connection.paused) connection.resume()
      } catch (e) {
        debug('audio pause/unpause error', e)
        bot.tmpResponse(msg, '**pause/unpause error**', 5000)
      }
    },
    {
      description: 'pause/resume current audio',
      fullDescription:
        'will toggle pausing and playing the current audio :pause_button:'
    }
  )

  bot.registerCommand(
    'cena',
    async (msg, args) => {
      try {
        ;(await getVcConnection(msg, true)).play(
          'https://cdn.glitch.com/9dd5ac6b-827a-4403-85d1-9ce1cc6ee750%2Fand-his-name-is-john-cena-1.mp3?1535563563167',
          {
            inlineVolume: true
          }
        )
      } catch (e) {
        debug('audio playback error', e)
        bot.tmpResponse(msg, '**VoiceConnection Error**', 5000)
      }
    },
    {
      description: 'play meme audio',
      fullDescription: 'attempt to play some funny audio :smile:'
    }
  )

  bot.registerCommand(
    'volume',
    async (msg, args) => {
      var isSettingVolume =
        args[0] != undefined &&
        parseInt(args[0]) >= 0 &&
        parseInt(args[0]) <= 75

      try {
        await bot.db.read()

        var connection = (await getVcConnection(msg, false)) || {
          volume: bot.db.data.config.volume || 0.1,
          setVolume (v) {
            this.volume = v
          }
        }

        if (isSettingVolume) {
          connection.setVolume(args[0] / 100)
          bot.db.data.config.volume = connection.volume
          await bot.db.write()
        }

        bot.tmpResponse(
          msg,
          `Bot\'s volume is now: \`${connection.volume * 100}%\``,
          5000
        )
      } catch (e) {
        debug(' error', e)
        bot.tmpResponse(msg, '**Set volume Error**', 5000)
      }
    },
    {
      description: 'edits bot volume',
      fullDescription:
        "pass in a value between **0 and 75** to set the bot's volume",
      deleteCommand: true
    }
  )

  bot.registerCommand(
    'join',
    async (msg, args) => {
      try {
        ;(await getVcConnection(msg, true)).switchChannel(
          msg.member.voiceState.channelID
        )
      } catch (e) {
        if (e.message == 'notInVC') {
          bot.tmpResponse(
            msg,
            'You are not currently in any voice channels :angry:',
            5000
          )
        } else debug('voice channel switch error: ' + error)
      }
    },
    {
      description: 'switches active voice channel',
      fullDescription: 'switched to a new voice channel'
    }
  )

  bot.registerCommand(
    'leave',
    (msg, args) => {
      try {
        const guild = bot.guilds.get(msg.guildID)
        var connection = bot.voiceConnections.find(c => c.id == msg.guildID)

        if (!connection) {
          bot.tmpResponse(msg, 'I am not currently in any voice channels', 5000)
          return
        }
        const vc = guild.channels.get(connection.channelID)
        vc.leave()
      } catch (error) {
        debug('leave error: ' + error)
      }
    },
    {
      description: 'leaves voice channel',
      fullDescription: 'has bot leave their current voice channel'
    }
  )
}

function disable (bot) {
  bot.unregisterCommand('play')
  bot.unregisterCommand('stop')
  bot.unregisterCommand('toggleaudio')
  bot.unregisterCommand('cena')
  bot.unregisterCommand('volume')
  bot.unregisterCommand('join')
  bot.unregisterCommand('leave')
}

export default { enable, disable, desc: 'default mode with normal functions' }
