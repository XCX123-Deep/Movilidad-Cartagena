// api/users/[uid].js — Vercel Serverless Function para /api/users/:uid
import { connectDB, User } from '../db.js';
import { requireAuth } from '../middleware.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  await connectDB();

  await new Promise((resolve, reject) => {
    requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
  }).catch(() => null);
  if (res.writableEnded) return;

  const { uid } = req.query;
  const isAdmin = req.firebaseUser.email === 'juniorborre011@gmail.com';
  const isSelf = req.firebaseUser.uid === uid;

  if (req.method === 'GET') {
    if (!isSelf && !isAdmin) {
      const callerDoc = await User.findOne({ uid: req.firebaseUser.uid }).lean();
      if (!callerDoc || (callerDoc.role !== 'admin' && callerDoc.role !== 'super_admin')) {
        return res.status(403).json({ error: 'Prohibido' });
      }
    }
    const user = await User.findOne({ uid }).lean();
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    return res.json(user);
  }

  if (req.method === 'PATCH') {
    // Verificar que quien llama tiene permisos
    const adminOnlyFields = ['role', 'status'];
    const hasAdminFields = adminOnlyFields.some(f => f in (req.body || {}));
    if (hasAdminFields && !isAdmin && !isSelf) {
      const callerDoc = await User.findOne({ uid: req.firebaseUser.uid }).lean();
      if (!callerDoc || (callerDoc.role !== 'admin' && callerDoc.role !== 'super_admin')) {
        return res.status(403).json({ error: 'Prohibido' });
      }
    }
    const user = await User.findOneAndUpdate(
      { uid },
      { $set: req.body },
      { new: true, runValidators: true }
    ).lean();
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    return res.json(user);
  }

  if (req.method === 'DELETE') {
    if (!isAdmin) {
      const callerDoc = await User.findOne({ uid: req.firebaseUser.uid }).lean();
      if (!callerDoc || (callerDoc.role !== 'admin' && callerDoc.role !== 'super_admin')) {
        return res.status(403).json({ error: 'Prohibido' });
      }
    }
    await User.deleteOne({ uid });
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Método no permitido' });
}
