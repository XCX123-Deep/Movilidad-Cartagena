// api/users.js — Vercel Serverless Function
import { connectDB, User } from './db.js';
import { requireAuth, requireAdmin } from './middleware.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  await connectDB();

  // Autenticar
  await new Promise((resolve, reject) => {
    requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
  }).catch(() => null);
  if (res.writableEnded) return;

  if (req.method === 'GET') {
    // Solo admin puede listar todos los usuarios
    await new Promise((resolve, reject) => {
      requireAdmin(req, res, (err) => (err ? reject(err) : resolve()));
    }).catch(() => null);
    if (res.writableEnded) return;

    const users = await User.find().lean();
    return res.json(users);
  }

  if (req.method === 'POST') {
    const data = req.body;
    const uid = data.uid || req.firebaseUser.uid;

    const isAdmin = req.firebaseUser.email === 'juniorborre011@gmail.com';
    if (uid !== req.firebaseUser.uid && !isAdmin) {
      return res.status(403).json({ error: 'Prohibido' });
    }

    const user = await User.findOneAndUpdate(
      { uid },
      { $set: data },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    return res.json(user);
  }

  res.status(405).json({ error: 'Método no permitido' });
}
