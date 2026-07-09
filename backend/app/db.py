import aiosqlite
import logging

logger = logging.getLogger(__name__)

DB_PATH = "meetings.db"

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('''
            CREATE TABLE IF NOT EXISTS meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transcript TEXT,
                summary TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        await db.commit()
        logger.info("Database initialized.")

async def save_meeting(transcript: str, summary: str):
    if not transcript:
        return
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute('''
                INSERT INTO meetings (transcript, summary)
                VALUES (?, ?)
            ''', (transcript, summary))
            await db.commit()
            logger.info("Meeting saved to database.")
    except Exception as e:
        logger.error(f"Failed to save meeting to DB: {e}")
