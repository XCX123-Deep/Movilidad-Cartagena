import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json());

  // ─── Importaciones del API (backend) ──────────────────────────────────────
  const { connectDB, User, Report } = await import('./api/db.js');
  const { requireAuth, requireAdmin } = await import('./api/middleware.js');

  // Conectar a MongoDB
  await connectDB().catch(err => {
    console.error('MongoDB connection error:', err.message);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RUTAS DE USUARIOS  /api/users
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/users — lista todos los usuarios (solo admin)
  app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      const users = await User.find().lean();
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/users/:uid — obtener perfil propio
  app.get('/api/users/:uid', requireAuth, async (req, res) => {
    try {
      const { uid } = req.params;
      // Solo puede leer su propio perfil (o admin cualquiera)
      const isAdmin = req.firebaseUser.email === 'juniorborre011@gmail.com';
      if (req.firebaseUser.uid !== uid && !isAdmin) {
        return res.status(403).json({ error: 'Prohibido' });
      }
      const user = await User.findOne({ uid }).lean();
      if (!user) return res.status(404).json({ error: 'No encontrado' });
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/users — crear o actualizar perfil (upsert por uid)
  app.post('/api/users', requireAuth, async (req, res) => {
    try {
      const data = req.body;
      const uid = data.uid || req.firebaseUser.uid;

      // Solo puede crear/actualizar su propio perfil (excepto admin)
      const isAdmin = req.firebaseUser.email === 'juniorborre011@gmail.com';
      if (uid !== req.firebaseUser.uid && !isAdmin) {
        return res.status(403).json({ error: 'Prohibido' });
      }

      const user = await User.findOneAndUpdate(
        { uid },
        { $set: data },
        { upsert: true, new: true, runValidators: true }
      ).lean();
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/users/:uid — actualizar campos específicos
  app.patch('/api/users/:uid', requireAuth, async (req, res) => {
    try {
      const { uid } = req.params;
      const isAdmin = req.firebaseUser.email === 'juniorborre011@gmail.com';
      const isSelf = req.firebaseUser.uid === uid;

      // Campos que solo admins pueden modificar
      const adminOnlyFields = ['role', 'status'];
      const hasAdminFields = adminOnlyFields.some(f => f in req.body);
      if (hasAdminFields && !isAdmin) {
        // Verificar si es admin en DB
        const callerDoc = await User.findOne({ uid: req.firebaseUser.uid });
        if (!callerDoc || (callerDoc.role !== 'admin' && callerDoc.role !== 'super_admin')) {
          return res.status(403).json({ error: 'Prohibido: requiere admin' });
        }
      }

      if (!isSelf && !isAdmin) {
        const callerDoc = await User.findOne({ uid: req.firebaseUser.uid });
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
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/users/:uid — eliminar usuario (solo admin)
  app.delete('/api/users/:uid', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { uid } = req.params;
      await User.deleteOne({ uid });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RUTAS DE REPORTES  /api/reports
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/reports — reportes activos
  app.get('/api/reports', requireAuth, async (req, res) => {
    try {
      const now = new Date();
      // Expirar automáticamente los reportes vencidos
      await Report.updateMany(
        { status: 'active', expiresAt: { $lt: now } },
        { $set: { status: 'expired' } }
      );
      const reports = await Report.find({ status: 'active' })
        .sort({ timestamp: -1 })
        .lean();
      // Serializar _id como id para compatibilidad con el frontend
      const serialized = reports.map(r => ({ ...r, id: r._id.toString(), _id: undefined }));
      res.json(serialized);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reports — crear reporte
  app.post('/api/reports', requireAuth, async (req, res) => {
    try {
      const now = Date.now();
      const report = await Report.create({
        ...req.body,
        reporterUid: req.firebaseUser.uid,
        timestamp: new Date(now),
        expiresAt: new Date(now + 45 * 60 * 1000), // 45 min
        status: 'active',
        confirmations: [],
        dismissals: [],
      });
      res.json({ ...report.toObject(), id: report._id.toString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/reports/:id — actualizar reporte (confirmaciones, estado)
  app.patch('/api/reports/:id', requireAuth, async (req, res) => {
    try {
      const report = await Report.findByIdAndUpdate(
        req.params.id,
        { $set: req.body },
        { new: true }
      ).lean();
      if (!report) return res.status(404).json({ error: 'No encontrado' });
      res.json({ ...report, id: report._id.toString(), _id: undefined });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/reports/:id — eliminar reporte (solo admin o dueño)
  app.delete('/api/reports/:id', requireAuth, async (req, res) => {
    try {
      const report = await Report.findById(req.params.id);
      if (!report) return res.status(404).json({ error: 'No encontrado' });
      const isAdmin = req.firebaseUser.email === 'juniorborre011@gmail.com';
      if (!isAdmin && report.reporterUid !== req.firebaseUser.uid) {
        return res.status(403).json({ error: 'Prohibido' });
      }
      await report.deleteOne();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FRONTEND — Vite (dev) o dist/ (producción)
  // ═══════════════════════════════════════════════════════════════════════════

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});
