import express from 'express';
import axios from 'axios';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { getUserData } from '../services/userService.js';
import { db, admin } from '../config/firebase.js';

const router = express.Router();

// 1. Get Followers Count
router.get('/followers', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  
  try {
    const userData = await getUserData(firebaseUid);
    
    if (!userData || !userData.instagramAccessToken || !userData.instagramUserId) {
      return res.status(400).json({ error: 'Instagram account not connected' });
    }
    
    const { instagramAccessToken, instagramUserId } = userData;
    
    const response = await axios.get(`https://graph.facebook.com/v19.0/${instagramUserId}`, {
      params: {
        fields: 'followers_count',
        access_token: instagramAccessToken
      }
    });
    
    res.json({
      followers: response.data.followers_count,
      instagramUserId: instagramUserId
    });
    
  } catch (error: any) {
    console.error('[Analytics] Error fetching followers:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to fetch followers',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 2. Get Engagement Rate
router.get('/engagement', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  
  try {
    const userData = await getUserData(firebaseUid);
    
    if (!userData || !userData.instagramAccessToken || !userData.instagramUserId) {
      return res.status(400).json({ error: 'Instagram account not connected' });
    }
    
    const { instagramAccessToken, instagramUserId } = userData;
    
    // Get followers count
    const profileResponse = await axios.get(`https://graph.facebook.com/v19.0/${instagramUserId}`, {
      params: {
        fields: 'followers_count',
        access_token: instagramAccessToken
      }
    });
    
    const followersCount = profileResponse.data.followers_count;
    
    // Get recent media posts
    const mediaResponse = await axios.get(`https://graph.facebook.com/v19.0/${instagramUserId}/media`, {
      params: {
        fields: 'id,like_count,comments_count,timestamp,media_type',
        limit: 25,
        access_token: instagramAccessToken
      }
    });
    
    const posts = mediaResponse.data.data || [];
    
    if (posts.length === 0) {
      return res.json({
        engagementRate: 0,
        totalPosts: 0,
        message: 'No posts found'
      });
    }
    
    // Calculate total engagements
    let totalEngagements = 0;
    posts.forEach((post: any) => {
      const likes = post.like_count || 0;
      const comments = post.comments_count || 0;
      totalEngagements += (likes + comments);
    });
    
    const engagementRate = followersCount > 0 
      ? (totalEngagements / (posts.length * followersCount)) * 100
      : 0;
    
    res.json({
      engagementRate: parseFloat(engagementRate.toFixed(2)),
      totalEngagements,
      totalPosts: posts.length,
      followersCount
    });
    
  } catch (error: any) {
    console.error('[Analytics] Error fetching engagement:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to fetch engagement rate',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 3. Get Weekly Reach
router.get('/reach', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  
  try {
    const userData = await getUserData(firebaseUid);
    
    if (!userData || !userData.instagramAccessToken || !userData.instagramUserId) {
      return res.status(400).json({ error: 'Instagram account not connected' });
    }
    
    const { instagramAccessToken, instagramUserId } = userData;
    
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60);
    
    const insightsResponse = await axios.get(`https://graph.facebook.com/v19.0/${instagramUserId}/insights`, {
      params: {
        metric: 'reach',
        period: 'day',
        since: sevenDaysAgo,
        until: now,
        access_token: instagramAccessToken
      }
    });
    
    const reachData = insightsResponse.data.data || [];
    
    if (reachData.length === 0 || !reachData[0].values) {
      return res.json({
        weeklyReach: 0,
        dailyReach: [],
        message: 'No reach data available'
      });
    }
    
    const dailyValues = reachData[0].values || [];
    const weeklyReach = dailyValues.reduce((sum: number, day: any) => {
      return sum + (day.value || 0);
    }, 0);
    
    res.json({
      weeklyReach,
      dailyReach: dailyValues,
      period: '7 days'
    });
    
  } catch (error: any) {
    console.error('[Analytics] Error fetching reach:', error.response?.data || error.message);
    
    if (error.response?.data?.error?.code === 100) {
      return res.json({
        weeklyReach: 0,
        message: 'Insights not available for this account type'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch weekly reach',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// 4. Get Auto-Replies Count
router.get('/auto-replies', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  
  try {
    const statsDoc = await db.collection('users')
      .doc(firebaseUid)
      .collection('stats')
      .doc('autoReplies')
      .get();
    
    if (!statsDoc.exists) {
      await db.collection('users')
        .doc(firebaseUid)
        .collection('stats')
        .doc('autoReplies')
        .set({
          totalCount: 0,
          lastReplyAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      
      return res.json({
        autoReplies: 0,
        lastReplyAt: null
      });
    }
    
    const statsData = statsDoc.data();
    
    res.json({
      autoReplies: statsData?.totalCount || 0,
      lastReplyAt: statsData?.lastReplyAt || null
    });
    
  } catch (error: any) {
    console.error('[Analytics] Error fetching auto-replies:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch auto-replies count',
      details: error.message
    });
  }
});

export default router;
