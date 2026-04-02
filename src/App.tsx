import React, { useState, useEffect, createContext, useContext } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup,
  signOut, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  addDoc, 
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  limit
} from './firebase';
import { initializeApp, getApp, getApps, deleteApp } from 'firebase/app';
import firebaseConfig from '../firebase-applet-config.json';
import { getAuth } from 'firebase/auth';
import { User } from 'firebase/auth';
import { increment } from 'firebase/firestore';
import { UserProfile, Report, ReportType } from './types';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { 
  AlertTriangle, 
  ShieldAlert, 
  Clock, 
  MapPin, 
  Plus, 
  LogOut, 
  User as UserIcon,
  Navigation,
  ChevronRight,
  Info,
  CheckCircle2,
  X,
  Ban,
  CheckCircle,
  Trash2,
  Search,
  UserPlus,
  Mic,
  ShieldCheck,
  Users,
  UserMinus,
  Edit2
} from 'lucide-react';

import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import confetti from 'canvas-confetti';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// Fix Leaflet marker icons
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// --- Context ---
const AuthContext = createContext<{
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}>({
  user: null,
  profile: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

const useAuth = () => useContext(AuthContext);

// --- Components ---

const RecenterMap = ({ center }: { center: [number, number] }) => {
  const map = useMapEvents({});
  useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
};

const MapResizer = () => {
  const map = useMapEvents({});
  useEffect(() => {
    // Llamar invalidateSize varias veces con delays progresivos
    // para garantizar que Leaflet recalcule el tamaño correctamente en móvil
    const timers = [
      setTimeout(() => map.invalidateSize(), 100),
      setTimeout(() => map.invalidateSize(), 300),
      setTimeout(() => map.invalidateSize(), 600),
      setTimeout(() => map.invalidateSize(), 1000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [map]);
  return null;
};

const ReportSkeleton = () => (
  <div className="p-4 rounded-2xl border border-slate-100 bg-slate-50 animate-pulse">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 bg-slate-200 rounded-xl" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-slate-200 rounded w-3/4" />
        <div className="h-3 bg-slate-200 rounded w-1/2" />
        <div className="h-3 bg-slate-200 rounded w-1/4" />
      </div>
    </div>
  </div>
);

const UserLocationMarker = ({ position }: { position: [number, number] }) => {
  const userIcon = L.divIcon({
    html: `<div class="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg animate-pulse"></div>`,
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
  return <Marker position={position} icon={userIcon} />;
};

const ReportTypeIcon = ({ type, className }: { type: ReportType, className?: string }) => {
  switch (type) {
    case 'transit_checkpoint':
      return <ShieldAlert className={`text-orange-500 ${className}`} />;
    case 'police_presence':
      return <AlertTriangle className={`text-blue-500 ${className}`} />;
    case 'traffic_flow':
      return <Clock className={`text-red-500 ${className}`} />;
  }
};

const ReportTypeName = (type: ReportType) => {
  switch (type) {
    case 'transit_checkpoint': return 'Retén de Tránsito';
    case 'police_presence': return 'Presencia Policial (Tránsito)';
    case 'traffic_flow': return 'Tráfico Lento';
  }
};

const LocationPicker = ({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) => {
  const [position, setPosition] = useState<[number, number] | null>(null);

  useMapEvents({
    click(e) {
      setPosition([e.latlng.lat, e.latlng.lng]);
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });

  return position === null ? null : (
    <Marker position={position} />
  );
};

const UserManagement = ({ currentUser, currentProfile }: { currentUser: User, currentProfile: UserProfile }) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    displayName: '',
    role: 'user' as const
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('email'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => doc.data() as UserProfile));
    });
    return () => unsubscribe();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    let secondaryApp: ReturnType<typeof initializeApp> | null = null;
    try {
      // Reusar o crear la app secundaria para no cerrar sesión del admin actual
      try {
        secondaryApp = getApp('Secondary');
      } catch {
        secondaryApp = initializeApp(firebaseConfig, 'Secondary');
      }
      const secondaryAuth = getAuth(secondaryApp);
      
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, newUser.email, newUser.password);
      const createdUser = userCredential.user;

      const newProfile: UserProfile = {
        uid: createdUser.uid,
        displayName: newUser.displayName || 'Usuario',
        email: newUser.email,
        role: newUser.role,
        status: 'active',
        sessionId: '',
        karma: 0
      };

      await setDoc(doc(db, 'users', createdUser.uid), newProfile);
      await secondaryAuth.signOut();
      
      setShowCreateModal(false);
      setNewUser({ email: '', password: '', displayName: '', role: 'user' });
      alert("Usuario creado exitosamente.");
    } catch (error: any) {
      console.error("Error creating user", error);
      alert("Error al crear usuario: " + error.message);
    } finally {
      // Limpiar siempre la app secundaria para evitar memory leak
      if (secondaryApp) {
        try { await deleteApp(secondaryApp); } catch {}
      }
      setCreating(false);
    }
  };

  const toggleUserStatus = async (user: UserProfile) => {
    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    try {
      await updateDoc(doc(db, 'users', user.uid), { status: newStatus });
    } catch (error) {
      console.error("Error toggling status", error);
      alert("No tienes permisos para realizar esta acción.");
    }
  };

  const deleteUser = async (user: UserProfile) => {
    if (!confirm(`¿Estás seguro de eliminar a ${user.displayName}?`)) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid));
    } catch (error) {
      console.error("Error deleting user", error);
      alert("No tienes permisos para eliminar a este usuario.");
    }
  };

  const updateUserRole = async (user: UserProfile, newRole: 'user' | 'admin' | 'super_admin') => {
    try {
      await updateDoc(doc(db, 'users', user.uid), { role: newRole });
    } catch (error) {
      console.error("Error updating role", error);
      alert("No tienes permisos para cambiar el rol.");
    }
  };

  const filteredUsers = users.filter(u => 
    u.displayName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => window.location.reload()} 
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            title="Regresar"
          >
            <ChevronRight className="w-6 h-6 text-slate-400 rotate-180" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Gestión de Usuarios</h2>
            <p className="text-slate-500">Administra roles y accesos del sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar usuario..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all w-64"
            />
          </div>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-100 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Nuevo Usuario</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Usuario</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Rol</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Estado</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((u) => (
                <tr key={u.uid} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <img src={u.photoURL || `https://ui-avatars.com/api/?name=${u.displayName}`} className="w-10 h-10 rounded-full border border-slate-200" alt="" />
                      <div>
                        <div className="font-bold text-slate-900">{u.displayName}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select 
                      value={u.role}
                      onChange={(e) => updateUserRole(u, e.target.value as any)}
                      disabled={
                        (currentProfile.role === 'admin' && u.role === 'super_admin') ||
                        (currentProfile.role === 'admin' && u.role === 'admin' && u.uid !== currentUser.uid)
                      }
                      className="bg-slate-100 border-none rounded-lg px-3 py-1 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="user">Usuario</option>
                      <option value="admin">Admin</option>
                      {currentProfile.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {u.status === 'active' ? 'Activo' : 'Deshabilitado'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => toggleUserStatus(u)}
                        disabled={
                          (currentProfile.role === 'admin' && u.role !== 'user') ||
                          u.uid === currentUser.uid
                        }
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          u.status === 'active' 
                            ? 'bg-red-50 text-red-600 hover:bg-red-100' 
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        } disabled:opacity-30`}
                      >
                        {u.status === 'active' ? (
                          <><Ban className="w-3 h-3" /> Deshabilitar</>
                        ) : (
                          <><CheckCircle className="w-3 h-3" /> Habilitar</>
                        )}
                      </button>
                      <button 
                        onClick={() => deleteUser(u)}
                        disabled={
                          (currentProfile.role === 'admin' && u.role !== 'user') ||
                          u.uid === currentUser.uid
                        }
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 text-slate-600 hover:bg-red-50 hover:text-red-600 rounded-lg text-xs font-bold transition-all disabled:opacity-30"
                      >
                        <Trash2 className="w-3 h-3" /> Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Crear Nuevo Usuario</h2>
                <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-slate-100 rounded-full">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              <form onSubmit={handleCreateUser} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Nombre Completo</label>
                  <input 
                    type="text" 
                    required
                    value={newUser.displayName}
                    onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Correo Electrónico</label>
                  <input 
                    type="email" 
                    required
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Contraseña</label>
                  <input 
                    type="password" 
                    required
                    minLength={6}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Rol</label>
                  <select 
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as any })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="user">Usuario</option>
                    <option value="admin">Administrador</option>
                    {currentProfile.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                  </select>
                </div>
                <button 
                  type="submit"
                  disabled={creating}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-100 disabled:opacity-50"
                >
                  {creating ? 'Creando...' : 'Crear Usuario'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const haptic = (type: 'short' | 'double' | 'error') => {
  if (!('vibrate' in navigator)) return;
  switch (type) {
    case 'short': navigator.vibrate(50); break;
    case 'double': navigator.vibrate([50, 50, 50]); break;
    case 'error': navigator.vibrate([100, 50, 100]); break;
  }
};

// --- Funciones de distancia (módulo-nivel) ---
const deg2rad = (deg: number) => deg * (Math.PI / 180);

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// --- Trfico tipo Waze ---
interface TrafficGroup {
  center: [number, number];
  count: number;
  representative: Report;
}

const groupTrafficReports = (reports: Report[]): TrafficGroup[] => {
  const traffic = reports.filter(
    r => r.type === 'traffic_flow' && r.status === 'active' && r.location?.latitude
  );
  const assigned = new Set<string>();
  const groups: TrafficGroup[] = [];

  traffic.forEach(report => {
    if (assigned.has(report.id)) return;
    const cluster = traffic.filter(r => {
      if (assigned.has(r.id)) return false;
      return getDistance(
        report.location.latitude, report.location.longitude,
        r.location.latitude, r.location.longitude
      ) < 0.3; // 300 metros
    });
    cluster.forEach(r => assigned.add(r.id));
    const avgLat = cluster.reduce((s, r) => s + r.location.latitude, 0) / cluster.length;
    const avgLng = cluster.reduce((s, r) => s + r.location.longitude, 0) / cluster.length;
    groups.push({ center: [avgLat, avgLng], count: cluster.length, representative: cluster[0] });
  });
  return groups;
};

const TrafficCircle = ({ group, onSelect }: { group: TrafficGroup; onSelect: (r: Report) => void; key?: string }) => {
  // Amarillo -> Naranja -> Rojo según intensidad
  const color = group.count >= 5 ? '#DC2626'   // Rojo: tráfico severo
              : group.count >= 3 ? '#EA580C'   // Naranja: tráfico denso
              : group.count >= 2 ? '#F97316'   // Naranja claro
              : '#CA8A04';                      // Amarillo: tráfico moderado
  const radius = Math.min(100 + group.count * 80, 500);
  const fillOpacity = Math.min(0.25 + group.count * 0.06, 0.55);

  return (
    <Circle
      center={group.center}
      radius={radius}
      pathOptions={{
        fillColor: color,
        fillOpacity,
        color,
        weight: 3,
        opacity: 0.85
      }}
      eventHandlers={{
        click: () => {
          haptic('short');
          onSelect(group.representative);
        }
      }}
    />
  );
};

const ReportMarker = ({ report, onConfirm, onSelect }: { report: Report, onConfirm: (id: string, still: boolean) => Promise<void> | void, onSelect: (report: Report) => void, key?: string }) => {
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const updateOpacity = () => {
      if (!report.expiresAt) return;
      const now = Date.now();
      const expiry = report.expiresAt.toDate().getTime();
      const remaining = expiry - now;
      
      if (remaining <= 0) {
        setOpacity(0);
      } else {
        // Start fading in the last 15 minutes
        const fadeStart = 15 * 60 * 1000;
        if (remaining < fadeStart) {
          setOpacity(Math.max(0.2, remaining / fadeStart));
        } else {
          setOpacity(1);
        }
      }
    };

    updateOpacity();
    const interval = setInterval(updateOpacity, 30000);
    return () => clearInterval(interval);
  }, [report]);

  if (!report.location?.latitude || !report.location?.longitude) return null;
  if (opacity <= 0 || report.status !== 'active') return null;

  const isVerified = (report.reporterKarma || 0) > 10 || (report.confirmations?.length || 0) >= 3;

  return (
    <Marker 
      position={[report.location.latitude, report.location.longitude]}
      opacity={opacity}
      eventHandlers={{
        click: () => {
          haptic('short');
          onSelect(report);
        }
      }}
    >
    </Marker>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'map' | 'users'>('map');
  const [currentSessionId] = useState(() => crypto.randomUUID());

  const [newReport, setNewReport] = useState<{
    type: ReportType;
    description: string;
    latitude: number | null;
    longitude: number | null;
  }>({
    type: 'transit_checkpoint',
    description: '',
    latitude: null,
    longitude: null,
  });
  const [userLocation, setUserLocation] = useState<[number, number]>([10.391, -75.479]); // Cartagena Default
  const [previousLocation, setPreviousLocation] = useState<[number, number] | null>(null);
  const startYRef = React.useRef(0);
  const [approachingReport, setApproachingReport] = useState<Report | null>(null);

  // Auto-dismiss del radar de proximidad a los 5 segundos
  useEffect(() => {
    if (!approachingReport) return;
    const timer = setTimeout(() => setApproachingReport(null), 5000);
    return () => clearTimeout(timer);
  }, [approachingReport]);

  const [showConfirmSheet, setShowConfirmSheet] = useState<Report | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<Partial<Report>[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [historicalReports, setHistoricalReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [isMapMoving, setIsMapMoving] = useState(false);
  const [debouncedReports, setDebouncedReports] = useState<Report[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);

  // Debounce reports update on map move
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedReports(reports);
    }, 300);
    return () => clearTimeout(timer);
  }, [reports]);

  // Handle App Visibility for WebSockets (onSnapshot)
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const setupListeners = () => {
      if (!user || activeTab !== 'map') return;
      
      const q = query(
        collection(db, 'reports'),
        where('status', '==', 'active'),
        orderBy('timestamp', 'desc')
      );

      unsubscribe = onSnapshot(q, (snapshot) => {
        const reportsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Report[];
        setReports(reportsData);
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setupListeners();
      } else {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      }
    };

    setupListeners();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      if (unsubscribe) unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, activeTab]);

  useEffect(() => {
    // Retention: Welcome back check
    const lastVisit = localStorage.getItem('lastVisit');
    const now = Date.now();
    if (lastVisit) {
      const daysSince = (now - parseInt(lastVisit)) / (1000 * 60 * 60 * 24);
      if (daysSince > 3) {
        setShowWelcomeBack(true);
        setTimeout(() => setShowWelcomeBack(false), 5000);
      }
    }
    localStorage.setItem('lastVisit', now.toString());
  }, []);

  useEffect(() => {
    // Safety timeout for loading state
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      clearTimeout(timeout);
      try {
        if (user) {
          // Check if user exists and set session
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userRef);
          
          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile;
            if (data.status === 'disabled') {
              alert("Tu cuenta ha sido deshabilitada.");
              await signOut(auth);
              setLoading(false);
              return;
            }
            
            // Auto-upgrade owner email to super_admin if needed
            if (user.email === "juniorborre011@gmail.com" && data.role !== 'super_admin') {
              await updateDoc(userRef, { role: 'super_admin' });
            }

            // Update session ID
            await updateDoc(userRef, { sessionId: currentSessionId });
          } else {
            // Create new user
            const isOwnerEmail = user.email === "juniorborre011@gmail.com";
            const newProfile: UserProfile = {
              uid: user.uid,
              displayName: user.displayName || 'Usuario',
              email: user.email || '',
              photoURL: user.photoURL || '',
              role: isOwnerEmail ? 'super_admin' : 'user',
              status: 'active',
              sessionId: currentSessionId,
              karma: 0
            };
            await setDoc(userRef, newProfile);
          }
          setUser(user);
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (error) {
        console.error("Auth state change error:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [currentSessionId]);

  // Get user location and handle proximity
  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const newLoc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setPreviousLocation(userLocation);
          setUserLocation(newLoc);
          
          // Radar de Proximidad
          if (reports.length > 0) {
            reports.forEach(report => {
              if (report.status !== 'active') return;
              
              const dist = getDistance(newLoc[0], newLoc[1], report.location.latitude, report.location.longitude);
              
              // Alerta de proximidad (800m)
              if (dist < 0.8 && dist > 0.1) {
                // Simple heading check: if distance is decreasing
                if (previousLocation) {
                  const prevDist = getDistance(previousLocation[0], previousLocation[1], report.location.latitude, report.location.longitude);
                  if (dist < prevDist) {
                    setApproachingReport(report);
                    // Vibration if supported
                    if ('vibrate' in navigator) navigator.vibrate(200);
                  }
                }
              } else if (dist >= 0.8) {
                if (approachingReport?.id === report.id) setApproachingReport(null);
              }

              // Confirmación con un toque (100m)
              if (dist < 0.1) {
                setShowConfirmSheet(report);
              } else if (dist > 0.2) {
                if (showConfirmSheet?.id === report.id) setShowConfirmSheet(null);
              }
            });
          }
        },
        () => console.log("Geolocation denied"),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [reports, userLocation, previousLocation, approachingReport, showConfirmSheet]);

  // Offline Sync
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      if (offlineQueue.length > 0) {
        offlineQueue.forEach(async (report) => {
          try {
            await addDoc(collection(db, 'reports'), {
              ...report,
              timestamp: serverTimestamp(),
              expiresAt: Timestamp.fromMillis(Date.now() + 45 * 60 * 1000)
            });
          } catch (e) {
            console.error("Sync error", e);
          }
        });
        setOfflineQueue([]);
        alert("Reportes sincronizados exitosamente.");
      }
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [offlineQueue]);

  // getDistance y deg2rad ahora son funciones de módulo (ver arriba)

  const startVoiceReporting = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Tu navegador no soporta reconocimiento de voz.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-CO';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      console.log("Voz detectada:", transcript);
      
      let type: ReportType = 'traffic_flow';
      if (transcript.includes('retén') || transcript.includes('tránsito')) type = 'transit_checkpoint';
      else if (transcript.includes('policía') || transcript.includes('tombos')) type = 'police_presence';
      else if (transcript.includes('tráfico') || transcript.includes('lento') || transcript.includes('trancón')) type = 'traffic_flow';

      const newReportData: Partial<Report> = {
        type,
        location: { latitude: userLocation[0], longitude: userLocation[1] },
        description: `Reporte por voz: "${transcript}"`,
        reporterUid: user?.uid || '',
        reporterName: profile?.displayName || 'Usuario',
        reporterKarma: profile?.karma || 0,
        status: 'active',
        confirmations: [],
        dismissals: []
      };

      if (isOffline) {
        setOfflineQueue([...offlineQueue, newReportData]);
        alert("Sin conexión. Reporte guardado localmente.");
      } else {
        handleSubmitReport(newReportData as any);
      }
    };
    recognition.start();
  };

  const handleConfirmReport = async (reportId: string, stillThere: boolean) => {
    if (!user) return;
    const reportRef = doc(db, 'reports', reportId);
    const report = reports.find(r => r.id === reportId);
    if (!report) return;

    try {
      if (stillThere) {
        haptic('short');
        const newConfirmations = [...(report.confirmations || []), user.uid];
        const updates: any = { confirmations: newConfirmations };
        
        // Extend TTL if 5+ confirmations
        if (newConfirmations.length >= 5) {
          const currentExpiry = report.expiresAt.toDate().getTime();
          updates.expiresAt = Timestamp.fromMillis(currentExpiry + 30 * 60 * 1000);
        }
        
        await updateDoc(reportRef, updates);
        // Increase reporter karma usando increment() para evitar race conditions
        await updateDoc(doc(db, 'users', report.reporterUid), { karma: increment(1) });
      } else {
        const newDismissals = [...(report.dismissals || []), user.uid];
        await updateDoc(reportRef, { 
          dismissals: newDismissals,
          status: newDismissals.length >= 3 ? 'resolved' : 'active'
        });
      }
      setShowConfirmSheet(null);
    } catch (e) {
      console.error("Error confirming report", e);
    }
  };

  const handleSubmitReport = async (reportData: Partial<Report>) => {
    if (!user) return;
    try {
      const now = Date.now();
      const expiresAt = Timestamp.fromMillis(now + 45 * 60 * 1000);
      
      await addDoc(collection(db, 'reports'), {
        ...reportData,
        reporterUid: user.uid,
        reporterName: profile?.displayName || 'Usuario',
        reporterKarma: profile?.karma || 0,
        timestamp: serverTimestamp(),
        expiresAt,
        status: 'active',
        confirmations: [],
        dismissals: []
      });

      haptic('double');
      
      // Celebration for first report or just any report
      if (profile && profile.karma === 0) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#2563eb', '#f59e0b', '#ef4444']
        });
        alert("¡Ya eres parte de la comunidad CartaVía! Tu primer reporte ha sido publicado.");
      }

      setShowAddModal(false);
    } catch (e: any) {
      console.error("Error submitting report", e);
      alert("Error al enviar el reporte. Por favor intenta más tarde.");
    }
  };

  const login = async () => {
    try {
      // Usar popup en todos los dispositivos (redirect causa problemas con COOP en móvil)
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  // Listen to profile changes (for session and status)
  useEffect(() => {
    if (!user) return;

    let unsubscribe: (() => void) | null = null;

    const setupProfileListener = () => {
      unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as UserProfile;
          setProfile(data);

          if (data.sessionId && data.sessionId !== currentSessionId) {
            alert("Se ha iniciado sesión en otro dispositivo. Se cerrará esta sesión.");
            signOut(auth);
          }

          if (data.status === 'disabled') {
            alert("Tu cuenta ha sido deshabilitada por un administrador.");
            signOut(auth);
          }
        }
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setupProfileListener();
      } else {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      }
    };

    setupProfileListener();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      if (unsubscribe) unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, currentSessionId]);

  useEffect(() => {
    if (!user || !showHeatmap) return;

    const q = query(
      collection(db, 'reports'),
      limit(500)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reportsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Report[];
      setHistoricalReports(reportsData);
    });

    return () => unsubscribe();
  }, [user, showHeatmap]);

  const handleRefresh = async () => {
    haptic('short');
    setIsRefreshing(true);
    // Simulate refresh delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsRefreshing(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    startYRef.current = touch.pageY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const distance = touch.pageY - startYRef.current;
    if (distance > 0 && distance < 150 && window.scrollY === 0) {
      setPullDistance(distance);
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 80) {
      handleRefresh();
    }
    setPullDistance(0);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8"
        >
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Navigation className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Cartagena Movilidad</h1>
            <p className="text-sm text-slate-500">Ingresa para continuar</p>
          </div>

          <div className="space-y-6">
            {/* Email Login Form */}
            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                const email = (e.target as any).email.value;
                const password = (e.target as any).password.value;
                try {
                  setLoading(true);
                  await signInWithEmailAndPassword(auth, email, password);
                } catch (error: any) {
                  alert("Error al ingresar: " + error.message);
                  setLoading(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Correo</label>
                <input 
                  name="email"
                  type="email" 
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  placeholder="tu@correo.com"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Contraseña</label>
                <input 
                  name="password"
                  type="password" 
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  placeholder="••••••••"
                />
              </div>
              <button 
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-100"
              >
                Ingresar
              </button>
            </form>

            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-slate-100"></div>
              <span className="flex-shrink mx-4 text-xs font-bold text-slate-300 uppercase">O</span>
              <div className="flex-grow border-t border-slate-100"></div>
            </div>

            <button 
              onClick={login}
              className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-3"
            >
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
              Ingresar con Google
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Navigation className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">Cartagena Movilidad</h1>
          </div>
          
          {(profile?.role === 'admin' || profile?.role === 'super_admin') && (
            <nav className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button 
                onClick={() => setActiveTab('map')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  activeTab === 'map' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Mapa
              </button>
              <button 
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  activeTab === 'users' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Usuarios
              </button>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
                  () => alert("Por favor habilita la ubicación en tu navegador.")
                );
              }
            }}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-blue-600"
            title="Mi ubicación"
          >
            <Navigation className="w-5 h-5" />
          </button>
          <div className="hidden sm:flex flex-col items-end">
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-slate-900">{profile?.displayName}</span>
              {profile?.role === 'super_admin' && <ShieldCheck className="w-3 h-3 text-purple-500" />}
              {profile?.role === 'admin' && <ShieldCheck className="w-3 h-3 text-blue-500" />}
            </div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              {profile?.role === 'super_admin' ? 'Super Admin' : profile?.role === 'admin' ? 'Administrador' : 'Usuario'}
            </span>
          </div>
          <button 
            onClick={logout}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600"
            title="Cerrar sesión"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative min-h-0">
        {activeTab === 'users' && profile && (profile.role === 'admin' || profile.role === 'super_admin') ? (
          <div className="flex-1 overflow-y-auto bg-slate-50">
            <UserManagement currentUser={user} currentProfile={profile} />
          </div>
        ) : (
          <>
            {/* Sidebar / List */}
            <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col h-[40vh] lg:h-auto">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-500" />
              Reportes Activos ({reports.length})
            </h2>
            <button 
              onClick={() => setShowAddModal(true)}
              className="lg:hidden bg-blue-600 text-white p-2 rounded-full shadow-md"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          <div 
            className="flex-1 overflow-y-auto p-4 space-y-4 relative"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Custom Pull-to-Refresh Indicator */}
            <AnimatePresence>
              {(pullDistance > 0 || isRefreshing) && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ 
                    height: isRefreshing ? 60 : Math.min(pullDistance, 100),
                    opacity: 1 
                  }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex items-center justify-center overflow-hidden"
                >
                  <motion.div
                    animate={{ rotate: isRefreshing ? 360 : pullDistance * 2 }}
                    transition={isRefreshing ? { repeat: Infinity, duration: 1, ease: "linear" } : {}}
                  >
                    <Navigation className="w-6 h-6 text-blue-600" />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {loading ? (
              <>
                <ReportSkeleton />
                <ReportSkeleton />
                <ReportSkeleton />
              </>
            ) : reports.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-slate-300" />
                </div>
                <p className="text-slate-500">No hay reportes activos en este momento.</p>
              </div>
            ) : (
              reports.map((report) => (
                <motion.div 
                  key={report.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-4 rounded-2xl border border-slate-100 bg-slate-50 hover:bg-white hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white rounded-xl shadow-sm">
                      <ReportTypeIcon type={report.type} className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-bold text-slate-900 text-sm">{ReportTypeName(report.type)}</h3>
                        <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                          {report.timestamp?.toDate ? formatDistanceToNow(report.timestamp.toDate(), { addSuffix: true, locale: es }) : 'Recién'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 line-clamp-2 mb-2">
                        {report.description || 'Sin descripción adicional.'}
                      </p>
                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                        <MapPin className="w-3 h-3" />
                        <span>
                          {report.location?.latitude?.toFixed(4) ?? '?'}, {report.location?.longitude?.toFixed(4) ?? '?'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
                      {(report.reporterUid === user.uid || profile?.role === 'admin') && (
                        <button 
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await updateDoc(doc(db, 'reports', report.id), { status: 'resolved' });
                            } catch (error) {
                              console.error("Failed to resolve report", error);
                            }
                          }}
                          className="p-1 hover:bg-green-100 text-green-600 rounded-lg transition-colors"
                          title="Marcar como resuelto"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Map Area - min-h-0 es clave para que flex-1 dé altura computada en móvil */}
        <div 
          className="flex-1 relative bg-slate-200 min-h-0"
          style={{ minHeight: '250px' }}
        >
          <MapContainer 
            center={userLocation} 
            zoom={13} 
            className="w-full h-full z-0"
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <MapResizer />
            <RecenterMap center={userLocation} />
            <UserLocationMarker position={userLocation} />
            {!showHeatmap ? (
              <>
                {/* Retenes y Policia -> Marcadores con clustering */}
                <MarkerClusterGroup chunkedLoading>
                  {debouncedReports
                    .filter(r => r.type !== 'traffic_flow')
                    .map((report) => (
                      <ReportMarker
                        key={report.id}
                        report={report}
                        onConfirm={handleConfirmReport}
                        onSelect={(r) => setSelectedReport(r)}
                      />
                    ))}
                </MarkerClusterGroup>
                {/* Trafico lento -> Circulos de color tipo Waze */}
                {groupTrafficReports(debouncedReports).map((group, i) => (
                  <TrafficCircle
                    key={`traffic-${i}`}
                    group={group}
                    onSelect={(r) => setSelectedReport(r)}
                  />
                ))}
              </>
            ) : (
              historicalReports
                .filter(r => r.location?.latitude)
                .map((report) => (
                  <Circle
                    key={report.id}
                    center={[report.location.latitude, report.location.longitude]}
                    radius={100}
                    pathOptions={{
                      fillColor: report.type === 'transit_checkpoint' ? 'red' : 'orange',
                      fillOpacity: 0.1,
                      color: 'transparent'
                    }}
                  />
                ))
            )}
          </MapContainer>

          {/* Leyenda de colores de trafico */}
          <div className="absolute bottom-24 left-4 z-40 bg-white/90 backdrop-blur-sm rounded-2xl p-3 shadow-lg border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Nivel de Tráfico</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-yellow-600 opacity-80" />
                <span className="text-[11px] font-medium text-slate-600">Moderado (1 reporte)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-orange-500 opacity-80" />
                <span className="text-[11px] font-medium text-slate-600">Denso (2-4 reportes)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-red-600 opacity-80" />
                <span className="text-[11px] font-medium text-slate-600">Severo (5+ reportes)</span>
              </div>
            </div>
          </div>

          {/* Heatmap Toggle */}
          <div className="absolute top-24 right-8 z-40">
            <button 
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`px-4 py-2 rounded-full font-bold text-xs shadow-lg transition-all flex items-center gap-2 ${
                showHeatmap ? 'bg-orange-500 text-white' : 'bg-white text-slate-600'
              }`}
            >
              <Info className="w-4 h-4" />
              {showHeatmap ? 'Ver Mapa Real' : 'Ver Mapa de Calor'}
            </button>
          </div>

          {/* Welcome Back Notification */}
          <AnimatePresence>
            {showWelcomeBack && (
              <motion.div 
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -100, opacity: 0 }}
                className="absolute top-24 left-1/2 -translate-x-1/2 z-[110] w-[90%] max-w-md"
              >
                <div className="bg-blue-600 text-white rounded-2xl p-4 shadow-2xl flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                    <Navigation className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="font-bold">¡Bienvenido de vuelta!</div>
                    <div className="text-xs opacity-90">Han habido nuevos reportes en tu zona desde tu última visita 👀</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Radar Banner */}
          <AnimatePresence>
            {approachingReport && (
              <motion.div 
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -100, opacity: 0 }}
                className="absolute top-24 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-md"
              >
                <div className="bg-white/90 backdrop-blur-md border border-blue-100 rounded-2xl p-4 shadow-2xl flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-6 h-6 text-blue-600 animate-bounce" />
                  </div>
                  <div className="flex-grow">
                    <div className="text-xs font-bold text-blue-600 uppercase tracking-wider">Radar de Proximidad</div>
                    <div className="font-bold text-slate-900">
                      {approachingReport.type === 'transit_checkpoint' ? 'Retén de Tránsito' : 
                       approachingReport.type === 'police_presence' ? 'Presencia Policial' : 'Tráfico Lento'}
                    </div>
                    <div className="text-xs text-slate-500">A menos de 800 metros adelante</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Report Detail Sheet */}
          <AnimatePresence>
            {selectedReport && (
              <>
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelectedReport(null)}
                  className="absolute inset-0 bg-black/20 z-[90] backdrop-blur-[2px]"
                />
                <motion.div 
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                  className="absolute bottom-0 left-0 right-0 z-[100] p-4"
                >
                  <div className="bg-white rounded-t-3xl shadow-2xl p-6 border-t border-slate-100 max-w-2xl mx-auto">
                    <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6" />
                    
                    <div className="flex items-center gap-4 mb-6">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                        selectedReport.type === 'transit_checkpoint' ? 'bg-amber-100 text-amber-600' :
                        selectedReport.type === 'police_presence' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-600'
                      }`}>
                        <ReportTypeIcon type={selectedReport.type} className="w-8 h-8" />
                      </div>
                      <div className="flex-grow">
                        <h3 className="text-xl font-bold text-slate-900">{ReportTypeName(selectedReport.type)}</h3>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Clock className="w-4 h-4" />
                          {selectedReport.timestamp?.toDate ? formatDistanceToNow(selectedReport.timestamp.toDate(), { addSuffix: true, locale: es }) : 'Recién'}
                        </div>
                      </div>
                      <button 
                        onClick={() => setSelectedReport(null)}
                        className="p-2 hover:bg-slate-100 rounded-full"
                      >
                        <X className="w-6 h-6 text-slate-400" />
                      </button>
                    </div>

                    {selectedReport.description && (
                      <div className="bg-slate-50 p-4 rounded-2xl mb-6">
                        <p className="text-slate-700 italic">"{selectedReport.description}"</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between p-4 bg-blue-50 rounded-2xl mb-8">
                      <div className="flex items-center gap-3">
                        <img 
                          src={`https://ui-avatars.com/api/?name=${selectedReport.reporterName}&background=random`} 
                          className="w-10 h-10 rounded-full border-2 border-white shadow-sm" 
                          alt="" 
                        />
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-1">
                            {selectedReport.reporterName}
                            {((selectedReport.reporterKarma || 0) > 10 || (selectedReport.confirmations?.length || 0) >= 3) && (
                              <CheckCircle className="w-4 h-4 text-blue-500" />
                            )}
                          </div>
                          {((selectedReport.reporterKarma || 0) > 10 || (selectedReport.confirmations?.length || 0) >= 3) && (
                            <div className="text-[10px] uppercase font-bold text-blue-600 tracking-wider">Reportero Confiable</div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-black text-blue-600 leading-none">{selectedReport.reporterKarma || 0}</div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Karma</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <button 
                        onClick={() => {
                          handleConfirmReport(selectedReport.id, true);
                          setSelectedReport(null);
                        }}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all shadow-lg shadow-green-100"
                      >
                        <CheckCircle className="w-6 h-6" />
                        <span>Sigue ahí</span>
                        <span className="text-[10px] opacity-80">({selectedReport.confirmations?.length || 0} confirmaciones)</span>
                      </button>
                      <button 
                        onClick={() => {
                          handleConfirmReport(selectedReport.id, false);
                          setSelectedReport(null);
                        }}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-4 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all"
                      >
                        <X className="w-6 h-6" />
                        <span>Ya no está</span>
                        <span className="text-[10px] opacity-80">({selectedReport.dismissals?.length || 0} reportes)</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Confirm Sheet */}
          <AnimatePresence>
            {showConfirmSheet && (
              <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                className="absolute bottom-0 left-0 right-0 z-[100] p-4"
              >
                <div className="bg-white rounded-t-3xl shadow-2xl p-6 border-t border-slate-100">
                  <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6" />
                  <h3 className="text-xl font-bold text-slate-900 mb-2 text-center">¿Sigue el reporte aquí?</h3>
                  <p className="text-slate-500 text-center mb-8">Ayuda a la comunidad confirmando la veracidad del dato.</p>
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => handleConfirmReport(showConfirmSheet.id, true)}
                      className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all"
                    >
                      <CheckCircle className="w-5 h-5" /> Sigue ahí
                    </button>
                    <button 
                      onClick={() => handleConfirmReport(showConfirmSheet.id, false)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all"
                    >
                      <X className="w-5 h-5" /> Ya no está
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Offline Indicator */}
          <AnimatePresence>
            {isOffline && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] bg-amber-500 text-white px-4 py-1 rounded-full text-xs font-bold flex items-center gap-2 shadow-lg"
              >
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                Modo Sin Conexión
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating Action Button */}
          <div className="absolute bottom-8 right-8 z-40 flex flex-col gap-4 items-end">
            <button 
              onClick={startVoiceReporting}
              className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 ${
                isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white text-slate-600'
              }`}
            >
              <Mic className="w-6 h-6" />
            </button>
            <button 
              onClick={() => setShowAddModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
            >
              <Plus className="w-8 h-8" />
            </button>
          </div>
        </div>
          </>
        )}
      </main>

      {/* Add Report Bottom Sheet */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-2xl bg-white rounded-t-[40px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between shrink-0">
                <div className="w-12" /> {/* Spacer */}
                <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
                <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-full">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              
              <div className="p-8 space-y-8 overflow-y-auto flex-1 pb-12">
                <div className="text-center">
                  <h2 className="text-2xl font-black text-slate-900 mb-2">Nuevo Reporte</h2>
                  <p className="text-slate-500">Ayuda a otros conductores informando lo que ves.</p>
                </div>

                {/* Type Selection */}
                <div>
                  <label className="block text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">¿Qué está pasando?</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {(['transit_checkpoint', 'police_presence', 'traffic_flow'] as ReportType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => {
                          haptic('short');
                          setNewReport({ ...newReport, type });
                        }}
                        className={`p-6 rounded-[32px] border-2 transition-all text-center flex flex-col items-center gap-3 ${
                          newReport.type === type 
                            ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-xl shadow-blue-100 scale-105' 
                            : 'border-slate-100 hover:border-slate-200 text-slate-600'
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                          newReport.type === type ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'
                        }`}>
                          <ReportTypeIcon type={type} className="w-7 h-7" />
                        </div>
                        <span className="text-sm font-black leading-tight">{ReportTypeName(type)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Detalles adicionales</label>
                  <textarea 
                    value={newReport.description}
                    onChange={(e) => setNewReport({ ...newReport, description: e.target.value })}
                    placeholder="Ej: Retén en la Av. Pedro de Heredia, sentido centro..."
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-[32px] p-6 text-slate-900 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all h-32 resize-none text-lg"
                  />
                </div>

                {/* Location Picker */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <label className="block text-sm font-bold text-slate-400 uppercase tracking-widest">
                      Ubicación
                    </label>
                    <button 
                      onClick={() => {
                        haptic('short');
                        if (!navigator.geolocation) {
                          alert('Tu dispositivo no soporta geolocalización.');
                          return;
                        }
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            const lat = pos.coords.latitude;
                            const lng = pos.coords.longitude;
                            setUserLocation([lat, lng]);
                            setNewReport(prev => ({ ...prev, latitude: lat, longitude: lng }));
                          },
                          (err) => {
                            console.error('Geolocation error:', err);
                            alert('No se pudo obtener tu ubicación. Asegúrate de haber dado permiso de ubicación al navegador y que HTTPS esté activo.');
                          },
                          { enableHighAccuracy: true, timeout: 10000 }
                        );
                      }}
                      className="text-sm text-blue-600 font-black hover:underline flex items-center gap-1"
                    >
                      <Navigation className="w-4 h-4" />
                      Usar mi ubicación
                    </button>
                  </div>
                  <div className="h-72 rounded-[40px] overflow-hidden border-4 border-slate-50 shadow-inner relative group">
                    <MapContainer center={userLocation} zoom={15} className="w-full h-full">
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      <RecenterMap center={userLocation} />
                      <MapResizer />
                      <LocationPicker onLocationSelect={(lat, lng) => {
                        haptic('short');
                        setNewReport({ ...newReport, latitude: lat, longitude: lng });
                      }} />
                      {/* Mostrar punto azul de ubicacion actual del usuario en el mini-mapa */}
                      <UserLocationMarker position={userLocation} />
                    </MapContainer>
                    {!newReport.latitude && (
                      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px] pointer-events-none flex items-center justify-center">
                        <div className="bg-white px-6 py-3 rounded-full shadow-2xl font-black text-slate-900 flex items-center gap-2">
                          <MapPin className="w-5 h-5 text-blue-600" />
                          Toca el mapa para marcar
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                  <button 
                    onClick={() => {
                      haptic('short');
                      if (!newReport.latitude || !newReport.longitude) return;
                      // Construir el objeto location correcto antes de enviar
                      handleSubmitReport({
                        type: newReport.type,
                        description: newReport.description,
                        location: {
                          latitude: newReport.latitude,
                          longitude: newReport.longitude
                        }
                      });
                    }}
                    disabled={!newReport.latitude}
                    className={`w-full py-6 rounded-[32px] font-black text-xl transition-all shadow-2xl ${
                      newReport.latitude 
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200 hover:-translate-y-1 active:translate-y-0' 
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    Publicar Reporte
                  </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
