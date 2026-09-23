import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Get current user's reading and listening stats
router.get('/me', async (req, res) => {
  const userId = req.user.id;

  try {
    const db = await getDb();

    // Aggregates from user_progress — excludes items hidden/restricted for this user, same
    // as every listing endpoint, so a stat can't reveal a hidden item's existence via count.
    const statsRow = await db.get(`
      SELECT
        COALESCE(SUM(p.current_time), 0) as total_seconds_listened,
        COALESCE(SUM(p.current_page), 0) as total_pages_read,
        COUNT(CASE WHEN p.is_finished = 1 THEN 1 END) as completed_count,
        COUNT(CASE WHEN p.is_finished = 0 AND p.progress_percent > 0 THEN 1 END) as in_progress_count
      FROM user_progress p
      WHERE p.user_id = ?
      AND p.item_id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
    `, [userId, userId]);

    // Breakdown of user items by media_type
    const typeBreakdown = await db.all(`
      SELECT i.media_type, COUNT(p.item_id) as count
      FROM user_progress p
      JOIN items i ON p.item_id = i.id
      WHERE p.user_id = ?
      AND p.item_id NOT IN (
        SELECT item_id FROM item_visibility
        WHERE user_id = ? OR user_id IS NULL
      )
      GROUP BY i.media_type
    `, [userId, userId]);

    const userBreakdownMap = {
      audiobook: { media_type: 'audiobook', count: 0 },
      manga: { media_type: 'manga', count: 0 },
      book: { media_type: 'book', count: 0 },
      movie: { media_type: 'movie', count: 0 },
      show: { media_type: 'show', count: 0 },
      anime: { media_type: 'anime', count: 0 }
    };
    for (const row of typeBreakdown) {
      if (userBreakdownMap[row.media_type]) {
        userBreakdownMap[row.media_type].count = row.count;
      }
    }

    res.json({
      stats: {
        totalSecondsListened: statsRow.total_seconds_listened,
        totalPagesRead: statsRow.total_pages_read,
        completedCount: statsRow.completed_count,
        inProgressCount: statsRow.in_progress_count,
        mediaBreakdown: Object.values(userBreakdownMap)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin system stats
router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();

    const totals = await db.get(`
      SELECT
        COUNT(id) as total_items,
        COALESCE(SUM(file_size), 0) as total_bytes,
        COALESCE(SUM(duration), 0) as total_duration
      FROM items
    `);

    const usersCount = await db.get('SELECT COUNT(id) as count FROM users');
    const librariesCount = await db.get('SELECT COUNT(id) as count FROM libraries');

    const detailedByType = await db.all(`
      SELECT
        media_type,
        COUNT(id) as count,
        COALESCE(SUM(file_size), 0) as bytes,
        COALESCE(SUM(duration), 0) as duration,
        COALESCE(SUM(total_pages), 0) as pages,
        COUNT(DISTINCT author) as unique_authors,
        COUNT(DISTINCT series) as unique_series
      FROM items
      GROUP BY media_type
    `);

    const totalBytes = totals.total_bytes || 0;
    const typeMap = {
      audiobook: {
        media_type: 'audiobook',
        count: 0,
        bytes: 0,
        duration: 0,
        pages: 0,
        unique_authors: 0,
        unique_series: 0,
        percentage_of_storage: '0.0',
        avg_bytes: 0
      },
      manga: {
        media_type: 'manga',
        count: 0,
        bytes: 0,
        duration: 0,
        pages: 0,
        unique_authors: 0,
        unique_series: 0,
        percentage_of_storage: '0.0',
        avg_bytes: 0
      },
      book: {
        media_type: 'book',
        count: 0,
        bytes: 0,
        duration: 0,
        pages: 0,
        unique_authors: 0,
        unique_series: 0,
        percentage_of_storage: '0.0',
        avg_bytes: 0
      },
      movie: {
        media_type: 'movie',
        count: 0,
        bytes: 0,
        duration: 0,
        pages: 0,
        unique_authors: 0,
        unique_series: 0,
        percentage_of_storage: '0.0',
        avg_bytes: 0
      },
      show: {
        media_type: 'show',
        count: 0,
        bytes: 0,
        duration: 0,
        pages: 0,
        unique_authors: 0,
        unique_series: 0,
        percentage_of_storage: '0.0',
        avg_bytes: 0
      },
      anime: {
        media_type: 'anime',
        count: 0,
        bytes: 0,
        duration: 0,
        pages: 0,
        unique_authors: 0,
        unique_series: 0,
        percentage_of_storage: '0.0',
        avg_bytes: 0
      }
    };

    for (const row of detailedByType) {
      if (typeMap[row.media_type]) {
        const count = row.count || 0;
        const bytes = row.bytes || 0;
        typeMap[row.media_type] = {
          media_type: row.media_type,
          count,
          bytes,
          duration: row.duration || 0,
          pages: row.pages || 0,
          unique_authors: row.unique_authors || 0,
          unique_series: row.unique_series || 0,
          percentage_of_storage: totalBytes > 0 ? ((bytes / totalBytes) * 100).toFixed(1) : '0.0',
          avg_bytes: count > 0 ? Math.round(bytes / count) : 0
        };
      }
    }

    res.json({
      totalItems: totals.total_items || 0,
      totalBytes: totals.total_bytes || 0,
      totalAudioDuration: totals.total_duration || 0,
      totalUsers: usersCount.count,
      totalLibraries: librariesCount.count,
      byType: Object.values(typeMap)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
