// api/users/create.js — Crear usuario en Firebase Auth + MongoDB (solo admin)
import admin from 'firebase-admin';
import { connectDB, User } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  await connectDB();

  await new Promise((resolve, reject) => {
    requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
  }).catch(() => null);
  if (res.writableEnded) return;

  await new Promise((resolve, reject) => {
    requireAdmin(req, res, (err) => (err ? reject(err) : resolve()));
  }).catch(() => null);
  if (res.writableEnded) return;

  const { email, password, displayName, role, status } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  try {
    // Crear usuario en Firebase Auth
    const firebaseUser = await admin.auth().createUser({
      email,
      password,
      displayName: displayName || 'Usuario',
    });

    // Crear perfil en MongoDB
    const profile = await User.create({
      uid: firebaseUser.uid,
      displayName: displayName || 'Usuario',
      email,
      photoURL: '',
      role: role || 'user',
      status: status || 'active',
      karma: 0,
      sessionId: '',
      createdAt: new Date().toISOString(),
    });

    return res.json({ uid: firebaseUser.uid, ...profile.toObject() });
  } catch (err) {
    console.error('Error creating user:', err);
    return res.status(500).json({ error: err.message });
  }
}
