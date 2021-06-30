import request from 'request'
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

  bot.registerCommand(
    'play',
    (msg, args) => {
      const channel = msg.channel.guild.channels.get(
        msg.member.voiceState.channelID
      )
      channel.leave()
      channel
        .join()
        .then(connection => {
          debug('connected to voice channel')
          connection.setVolume(0.1)
          connection.play(
            'https://cdn.glitch.com/9dd5ac6b-827a-4403-85d1-9ce1cc6ee750%2Fand-his-name-is-john-cena-1.mp3?1535563563167',
            {
              inlineVolume: true
            }
          )
          connection.on('end', function (end) {
            debug('leaving voice channel')
            channel.leave()
          })
        })
        .catch(e => {
          debug('audio playback error', e)
          bot.tmpResponse(msg, '**NOT SUPPOSED TO SEE THIS**', 5000)
        })
    },
    {
      description: 'play some audio',
      fullDescription:
        'Should attempt to play some funny audio. Does not always work :smile:'
    }
  )

  bot.registerCommand(
    'stop',
    (msg, args) => {
      bot.tmpResponse(msg, '__sorry...__', 5000)
      const channel = msg.channel.guild.channels.get(
        msg.member.voiceState.channelID
      )
      channel.leave()
    },
    {
      description: 'leaves voice channel',
      fullDescription: 'goodbye to current voice channel'
    }
  )
}

function disable (bot) {
  bot.unregisterCommand('play')
  bot.unregisterCommand('stop')
}

export default { enable, disable, desc: 'default mode with normal functions' }
