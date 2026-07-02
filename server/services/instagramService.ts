import axios from 'axios';

/**
 * Send a reply to an Instagram comment
 */
export async function sendReplyToComment(
  commentId: string,
  replyMessage: string,
  accessToken: string
) {
  try {
    console.log('[Instagram API] Sending reply to comment:', commentId);

    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${commentId}/replies`,
      {
        message: replyMessage
      },
      {
        params: {
          access_token: accessToken
        }
      }
    );

    console.log('[Instagram API] Reply sent successfully:', response.data);

    return {
      success: true,
      replyId: response.data.id
    };
  } catch (error: any) {
    console.error('[Instagram API] Error sending reply:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

/**
 * Get Instagram media details
 */
export async function getMediaDetails(mediaId: string, accessToken: string) {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      {
        params: {
          fields: 'id,caption,media_type,permalink,timestamp',
          access_token: accessToken
        }
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('[Instagram API] Error fetching media:', error.response?.data || error.message);
    return null;
  }
}
