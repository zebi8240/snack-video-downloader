const axios = require('axios');
const express = require('express');

const app = express();
app.use(express.json());
app.use(express.static('public'));

async function getSnackVideoData(videoLink) {
  // Link check karo
  if (!videoLink || !videoLink.includes('snackvideo.com')) {
    throw new Error('Ye Snack Video ka sahi link nahi hai. Link snackvideo.com se hona chahiye.');
  }

  const photoId = videoLink.match(/video\/(\d+)/)?.[1];
  if (!photoId) {
    throw new Error('Link me video ID nahi mili. Sahi link paste karo.');
  }

  let html;
  try {
    const response = await axios.get(videoLink, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
      },
      timeout: 10000
    });
    html = response.data;
  } catch (err) {
    throw new Error('Video page load nahi hua. Link check karo ya video private/deleted ho sakta hai.');
  }

  const clean = html.replace(/\\"/g, '"');

  // Us photoId ka data block dhoondo (thora bada window rakho taake sab mil jaye)
  const blockRegex = new RegExp(`"photo_id_str":"${photoId}"[\\s\\S]{0,8000}`);
  const blockMatch = clean.match(blockRegex);

  if (!blockMatch) {
    throw new Error('Video nahi mila. Ho sakta hai video delete ho gaya ho ya private ho.');
  }

  const block = blockMatch[0];

  // Thumbnail nikaalo
  const thumbMatch = block.match(/"cover_thumbnail_urls":\[\{"cdn":"[^"]+","url":"([^"]+)"/);
  const thumbnail = thumbMatch ? thumbMatch[1] : null;

  // Multiple quality options nikaalo (HEVC = chota size, AVC = zyada quality)
  const qualityRegex = /"url":"([^"]+\.mp4[^"]*)","backupUrl":\[[^\]]*\],"maxBitrate":(\d+),"avgBitrate":(\d+),"videoCodec":"([^"]+)"/g;
  const qualities = [];
  let qMatch;
  while ((qMatch = qualityRegex.exec(block)) !== null) {
    qualities.push({
      url: qMatch[1],
      avgBitrate: parseInt(qMatch[3]),
      codec: qMatch[4]
    });
  }

  if (qualities.length === 0) {
    // Fallback — agar quality list na mile to default url use karo
    const fallback = block.match(/"main_mv_urls":\[\{"cdn":"[^"]+","url":"([^"]+)"/);
    if (fallback) {
      qualities.push({ url: fallback[1], avgBitrate: 0, codec: 'default' });
    }
  }

  if (qualities.length === 0) {
    throw new Error('Video URL nahi mila. Ye video download nahi ho sakta.');
  }

  // Bitrate ke hisaab se sort karo — sabse zyada quality upar
  qualities.sort((a, b) => b.avgBitrate - a.avgBitrate);

  const labeledQualities = qualities.map((q, index) => ({
    label: index === 0 ? 'High Quality' : 'Standard Quality',
    url: q.url,
    codec: q.codec
  }));

  return {
    thumbnail,
    qualities: labeledQualities
  };
}

app.post('/api/download', async (req, res) => {
  try {
    const result = await getSnackVideoData(req.body.link);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.listen(3000, () => {
  console.log('Server chal raha hai: http://localhost:3000');
});