// api/reports/[id].js — Vercel Serverless Function para /api/reports/:id
import { connectDB, Report } from '../db.js';
import { requireAuth } from '../middleware.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  await connectDB();

  await new Promise((resolve, reject) => {
    requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
  }).catch(() => null);
  if (res.writableEnded) return;

  const { id } = req.query;

  if (req.method === 'PATCH') {
    const report = await Report.findByIdAndUpdate(
      id,
      { $set: req.body },
      { new: true }
    ).lean();
    if (!report) return res.status(404).json({ error: 'No encontrado' });
    return res.json({ ...report, id: report._id.toString(), _id: undefined });
  }

  if (req.method === 'DELETE') {
    const report = await Report.findById(id);
    if (!report) return res.status(404).json({ error: 'No encontrado' });
    const isAdmin = req.firebaseUser.email === 'juniorborre011@gmail.com';
    if (!isAdmin && report.reporterUid !== req.firebaseUser.uid) {
      return res.status(403).json({ error: 'Prohibido' });
    }
    await report.deleteOne();
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Método no permitido' });
}
