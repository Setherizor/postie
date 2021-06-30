import Debug from 'debug'
import request from 'request'
const debug = Debug('postie:module')

function enable (bot) {
  debug('Assistant Mode Ready!')

  bot.registerCommand(
    'recall',
    async (msg, args) => {
      // Define Resource Locations
      const ownerURI = `recall.${msg.author.id.toString()}`
      const resourceURI = `${ownerURI}.${args[0]}`

      // If we have argument and are listing items
      if (args[0] && args[0] == 'list') {
        // List Existing recalls
        await bot.db.read()
        let userObj = bot.db.data.ownerURI
        if (userObj && Object.keys(userObj).length != 0) {
          bot.tmpResponse(
            msg,
            `:clipboard: Here is a list \n ${'```json\n' +
              Object.keys(userObj) +
              '```'}`,
            10000
          )
        } else {
          bot.tmpResponse(msg, `You have no recalls that I know of.`, 10000)
        }
      }
      // If we have an argument
      else if (args[0]) {
        // Check if record exists
        await bot.db.read()
        let result = bot.db.data.resourceURI
        if (result) {
          // If we have something stored
          debug('recall result:', result)
          let extension = result.split('.').reverse()[0]

          // Get file buffer
          request({ uri: result, encoding: null }, (err, resp, buffer) => {
            if (err) {
              debug('issue with request for image', err)
              return
            }
            // Send file and message back
            bot.createMessage(
              msg.channel.id,
              'Here you go :white_check_mark:',
              {
                file: buffer,
                name: `${msg.author.username}s-image.${extension}`
              }
            )
          })
        } else if (args[1]) {
          // If we are storing a new thing
          bot.db.data.resourceURI = args[1]
          await bot.db.write()
          bot.tmpResponse(
            msg,
            `:white_check_mark: Meme Shortcut \`${
              args[0]
            }\` successfully created!`,
            10000
          )
        }
        // No Args
      }
      // Error state
      else {
        bot.tmpResponse(
          msg,
          ':red_circle: You need to pass in a name and a url, or a name that has been entered :red_circle:',
          10000
        )
      }
    },
    {
      description: 'stores and retrieves urls',
      fullDescription:
        'Allows you to pass in the url of an image and a meaningful name. Later you can recall the image with this command and the name you specified'
    }
  )
}

function disable (bot) {
  bot.unregisterCommand('recall')
}

export default { enable, disable, desc: 'more user focused helper functions' }
