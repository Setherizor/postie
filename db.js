import { join } from 'path'
import { Low, JSONFile } from 'lowdb'
import { setValue, getValue } from './helpers.js'

// Use JSON file for storage
const file = join('.', 'data', 'db.json')
const db = new Low(new JSONFile(file))

async function init () {
  await db.read()
  // Set default data
  if (db.data == null) {
    db.data = {
      config: {
        mode: 'default'
      },
      guilds: {},
      recall: {},
      authTokens: {}
    }
  }
  await db.write()
  db.get = p => getValue(db.data, p)
  db.set = (p, v) => setValue(db.data, p, v)
  return db
}

export default await init()
