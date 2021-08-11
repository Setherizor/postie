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
      // connection.on('end', () => debug('stream ended'))
      connection.on('error', e => debug('stream error: ' + e))
      connection.on('userDisconnect', userId => {
        debug('user disconnected from VC: ' + userId)
      })
    }

    return connection
  }

  // Helper function to play online audio
  async function attemptToPlay (msg, url, time, verbose = false, bass = '5') {
    const strToSec = x => {
      if (x == undefined || x == null) return undefined
      var parts = x.split(':').map(x => parseInt(x))
      return parts[0] * 60 + parts[1]
    }

    try {
      var connection = await getVcConnection(msg, true)
      if (connection.playing) connection.stopPlaying()

      // use argument or included time
      var seek = strToSec(time)
      if (seek == undefined) {
        seek = url.includes('t=') ? parseInt(url.split('t=').pop()) : undefined
      }

      if (verbose)
        bot.tmpResponse(
          msg,
          ':musical_note: New video being played :thumbsup:',
          10000
        )

      connection.play(
        ytdl(url, {
          seek,
          quality: 'highestaudio',
          filter: 'audioonly',
          fmt: 'opus',
          encoderArgs: ['-af', 'bass=g=' + bass] // 5 is normal
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
      await attemptToPlay(msg, args[0], args[1], true)
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
    'soundboard',
    async (msg, args) => {
      var effects = {
        cena: 'https://youtu.be/KJ7B60OsKJI',
        fard: 'https://youtu.be/Q_9VMaX61nI',
        megafard: 'https://youtu.be/cWHRB98McEc',
        gud: 'https://youtu.be/1PwaAtp4aNI',
        triple: 'https://youtu.be/p-94ZwwnDe8',
        gameover: 'https://youtu.be/d0mxfCArM7Y',
        wat: 'https://youtu.be/9jAZrzDe3aQ',
        suprise: 'https://youtu.be/QoBhFHFSgso',
        bruh: 'https://youtu.be/D2_r4q2imnQ',
        sad: 'https://youtu.be/CQeezCdF4mk',
        f: 'https://youtu.be/_asNhzXq72w',
        waiting: 'https://youtu.be/73tGe3JE5IU'
      }
      var keys = Object.keys(effects)

      if (args[0] == undefined || !keys.includes(args[0])) {
        bot.tmpResponse(
          msg,
          'what sound effect do you want to play bro?\n`' +
            keys.join(', ') +
            '`',
          30000
        )
        return
      }
      await attemptToPlay(msg, effects[args[0]], args[1], false)
    },
    {
      aliases: ['sb'],
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
  bot.unregisterCommand('soundboard')
  bot.unregisterCommand('volume')
  bot.unregisterCommand('join')
  bot.unregisterCommand('leave')
}

export default { enable, disable, desc: 'default mode with normal functions' }
