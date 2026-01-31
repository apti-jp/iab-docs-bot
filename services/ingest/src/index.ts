import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { PubSub } from '@google-cloud/pubsub';

const app = express();

// Slack署名検証のためにraw bodyが必要
app.use(
  express.json({
    verify: (req: Request, _res, buf) => {
      (req as Request & { rawBody: Buffer }).rawBody = buf;
    },
  }),
);

const PORT = process.env.PORT || 8080;
const PUBSUB_TOPIC = process.env.PUBSUB_TOPIC || 'slack-events';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// Pub/Sub client
const pubsub = new PubSub();

/**
 * Slack署名を検証する
 */
function verifySlackSignature(req: Request & { rawBody?: Buffer }): boolean {
  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

  if (!timestamp || !signature || !req.rawBody) {
    return false;
  }

  // タイムスタンプが5分以上古い場合は拒否（リプレイ攻撃対策）
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    console.warn('Request timestamp too old');
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${req.rawBody.toString()}`;
  const mySignature = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(sigBasestring).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
}

/**
 * Slack Events エンドポイント
 */
app.post('/slack/events', async (req: Request, res: Response) => {
  // 署名検証
  if (!verifySlackSignature(req as Request & { rawBody?: Buffer })) {
    console.error('Invalid Slack signature');
    res.status(401).send('Invalid signature');
    return;
  }

  const body = req.body;

  // URL Verification (Slack Event Subscriptions 設定時)
  if (body.type === 'url_verification') {
    console.log('URL verification challenge received');
    res.set('Content-Type', 'text/plain');
    res.send(body.challenge);
    return;
  }

  // Event Callback
  if (body.type === 'event_callback') {
    const event = body.event;

    // app_mention イベントのみ処理
    if (event?.type === 'app_mention') {
      console.log(`Received app_mention: event_id=${body.event_id}`);

      // Pub/Sub にメッセージをpublish
      try {
        const message = {
          event_id: body.event_id,
          event_time: body.event_time,
          team_id: body.team_id,
          channel: event.channel,
          user: event.user,
          text: event.text,
          ts: event.ts,
          thread_ts: event.thread_ts || event.ts, // スレッド返信用
        };

        await pubsub.topic(PUBSUB_TOPIC).publishMessage({
          data: Buffer.from(JSON.stringify(message)),
        });

        console.log(`Published to Pub/Sub: event_id=${body.event_id}`);
      } catch (err) {
        console.error('Failed to publish to Pub/Sub:', err);
        // Pub/Sub失敗でも200を返す（Slackのリトライを防ぐ）
      }
    }
  }

  // 即座に200を返す（3秒制約対策）
  res.status(200).send('ok');
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('healthy');
});

app.listen(PORT, () => {
  console.log(`slack-ingest listening on port ${PORT}`);
  console.log(`PUBSUB_TOPIC: ${PUBSUB_TOPIC}`);
});
