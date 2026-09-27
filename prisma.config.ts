import path from 'path'
import { defineConfig } from 'prisma/config'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error(
    'Missing required environment variable DATABASE_URL. ' +
    'Set it in your .env.local file or deployment environment before starting the application.'
  )
}

export default defineConfig({
  earlyAccess: true,
  schema: path.join('prisma', 'schema.prisma'),
  migrate: {
    adapter: async () => {
      const { PrismaNeon } = await import('@prisma/adapter-neon')
      const { Pool } = await import('@neondatabase/serverless')
      const pool = new Pool({ connectionString: DATABASE_URL })
      return new PrismaNeon(pool)
    },
  },
})
