// api/reports.js — Vercel Serverless Function para /api/reports
import { connectDB, Report } from './db.js';
import { requireAuth } from './middleware.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  await connectDB();

  await new Promise((resolve, reject) => {
    requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
  }).catch(() => null);
  if (res.writableEnded) return;

  if (req.method === 'GET') {
    const now = new Date();
    // Expirar reportes vencidos automáticamente
    await Report.updateMany(
      { status: 'active', expiresAt: { $lt: now } },
      { $set: { status: 'expired' } }
    );
    const reports = await Report.find({ status: 'active' })
      .sort({ timestamp: -1 })
      .lean();
    const serialized = reports.map(r => ({ ...r, id: r._id.toString(), _id: undefined }));
    return res.json(serialized);
  }

  if (req.method === 'POST') {
    const now = Date.now();
    const report = await Report.create({
      ...req.body,
      reporterUid: req.firebaseUser.uid,
      timestamp: new Date(now),
      expiresAt: new Date(now + 45 * 60 * 1000),
      status: 'active',
      confirmations: [],
      dismissals: [],
    });
    const obj = report.toObject();
    return res.json({ ...obj, id: obj._id.toString(), _id: undefined });
  }

  res.status(405).json({ error: 'Método no permitido' });
}
