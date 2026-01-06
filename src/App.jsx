import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, update, get, push, remove, onDisconnect } from "firebase/database";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, onAuthStateChanged, signOut, updateProfile } from "firebase/auth";
import Peer from 'peerjs';
import { 
  Mic, MicOff, Play, Volume2, VolumeX, Sun, Moon, LogOut, Copy, Loader2, Edit3, X, MessageSquare, Send,
  Search, Vote, SkipForward, Megaphone, User, Crown
} from 'lucide-react';

// --- CONFIG ---
// تأكد من تفعيل Authentication (Anonymous + Google) و Realtime Database في كونسول فايربيس
const firebaseConfig = {
  apiKey: "AIzaSyAoNxgu8X_s6PaLJSmUO6TC3r8b992YGPs", 
  authDomain: "bor3y-game.firebaseapp.com",
  databaseURL: "https://bor3y-game-default-rtdb.firebaseio.com",
  projectId: "bor3y-game",
  storageBucket: "bor3y-game.appspot.com",
  messagingSenderId: "286762509370",
  appId: "1:286762509370:web:4ba819f6cc65f304ce8103",
  measurementId: "G-X5SZL01PW8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Avatar Seeds
const AVATAR_SEEDS = ["Ranger", "Sniper", "Ghost", "Viper", "Titan", "Shadow", "Ninja", "Samurai", "Wizard", "King", "Queen", "Prince", "Joker", "Bat", "Spider", "Iron", "Captain", "Thor", "Hulk", "Widow"];
const AVATARS = AVATAR_SEEDS.map((seed, i) => ({ id: `skin_${i}`, src: `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffdfbf,ffd5dc&radius=10` }));

function App() {
  // --- State ---
  const [darkMode, setDarkMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [step, setStep] = useState('login'); 
  const [roomId, setRoomId] = useState('');
  const [players, setPlayers] = useState([]);
  const [gameState, setGameState] = useState({ started: false }); 
  const [guestName, setGuestName] = useState('');
  const [selectedAvatarId, setSelectedAvatarId] = useState(AVATARS[0].id);
  
  // Refs to avoid Stale Closures (مشكلة عدم تحديث البيانات داخل الوظائف)
  const stepRef = useRef('login');
  const gameStateRef = useRef({ started: false });
  const userRef = useRef(null);
  const playersRef = useRef([]);

  // UI & Chat State
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const chatScrollRef = useRef(null);

  // Audio State
  const [peerId, setPeerId] = useState('');
  const [isMuted, setIsMuted] = useState(false); // المايك بتاعي
  const [deafenedPlayers, setDeafenedPlayers] = useState({}); // الناس اللي أنا عملت لهم ميوت
  const myPeer = useRef();
  const userStream = useRef();
  const peersRef = useRef({}); 
  const roomListenerRef = useRef(null);

  // Helper: Toast
  const showToast = (msg, type = 'error') => { 
    setToast({ msg, type }); 
    setTimeout(() => setToast(null), 3000); 
  };

  // --- AUTH & INIT ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        const savedAvatar = localStorage.getItem('bor3y_avatar') || AVATARS[0].id;
        setSelectedAvatarId(savedAvatar);
        const userData = { uid: u.uid, name: u.displayName || "Agent", avatarId: savedAvatar };
        setUser(userData);
        userRef.current = userData;
        updateStep('home');
        initPeer(u.uid);
      } else { 
        setUser(null); 
        userRef.current = null;
        updateStep('login'); 
      }
    });
    return () => {
        unsubscribe();
        cleanupPeer();
        if(roomListenerRef.current) off(roomListenerRef.current);
    };
  }, []);

  const updateStep = (newStep) => {
    setStep(newStep);
    stepRef.current = newStep;
  };

  const cleanupPeer = () => {
    if(myPeer.current) myPeer.current.destroy();
    if(userStream.current) {
        userStream.current.getTracks().forEach(track => track.stop());
    }
    document.querySelectorAll('audio').forEach(el => el.remove());
  };

  const initPeer = (uid) => {
    if (myPeer.current && !myPeer.current.destroyed) return;
    
    const peer = new Peer();
    myPeer.current = peer;
    
    peer.on('open', (id) => {
        setPeerId(id);
        if(roomId && user) {
             update(ref(db, `rooms/${roomId}/players/${user.uid}`), { peerId: id });
        }
    });
    
    peer.on('call', call => {
       navigator.mediaDevices.getUserMedia({ audio: true })
         .then((s) => { 
             userStream.current = s;
             call.answer(s); 
             call.on('stream', (rs) => addAudioStream(rs, call.peer)); 
         })
         .catch(e => {
             console.warn("Mic Error", e);
             call.answer(); // Answer anyway to hear others
         });
    });
  };

  // --- LOGIN ---
  const handleGuestLogin = async () => {
    if (!guestName.trim()) return showToast("اكتب اسمك!");
    setLoading(true);
    try {
      const res = await signInAnonymously(auth);
      await updateProfile(res.user, { displayName: guestName });
    } catch { showToast("Login Error"); } finally { setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try { await signInWithPopup(auth, provider); } catch { showToast("Google Error"); } finally { setLoading(false); }
  };

  const handleLogout = () => { 
      cleanupPeer();
      signOut(auth); 
      window.location.reload(); 
  };
  
  const selectAvatar = (id) => { 
    setSelectedAvatarId(id); 
    localStorage.setItem('bor3y_avatar', id); 
    if (user) { 
      const updatedUser = { ...user, avatarId: id };
      setUser(updatedUser); 
      userRef.current = updatedUser;
      if (roomId) update(ref(db, `rooms/${roomId}/players/${user.uid}`), { avatarId: id }); 
    } 
    setShowAvatarModal(false); 
  };

  // --- CHAT ---
  const sendMessage = (text) => { 
    if(!roomId || !text.trim() || !user) return; 
    push(ref(db, `rooms/${roomId}/messages`), { senderId: user.uid, senderName: user.name, text, timestamp: Date.now() }); 
  };
  
  const handleChatSubmit = (e) => { 
    e.preventDefault(); 
    if (!chatInput.trim()) return; 
    sendMessage(chatInput); 
    setChatInput(""); 
  };
  
  useEffect(() => { 
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight; 
  }, [messages, showChatModal]);

  // --- ROOM SYNC (The Core Logic) ---
  const listenToRoom = (code) => {
    if(roomListenerRef.current) off(roomListenerRef.current);
    
    const roomRef = ref(db, `rooms/${code}`);
    roomListenerRef.current = roomRef;

    onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Players Sync
        const safePlayers = data.players ? Object.values(data.players) : [];
        setPlayers(safePlayers);
        playersRef.current = safePlayers;
        
        // Game State Sync
        const gs = data.gameState || { started: false };
        setGameState(gs);
        gameStateRef.current = gs;
        
        // Messages Sync
        const msgs = data.messages ? Object.values(data.messages).sort((a,b) => a.timestamp - b.timestamp) : [];
        if (msgs.length > messages.length && !showChatModal) setHasNewMessage(true);
        setMessages(msgs);

        // Smart Navigation
        // لو اللعبة بدأت وأنا لسه في اللوبي -> روح للجيم
        if (gs.started && stepRef.current === 'lobby') updateStep('game');
        // لو اللعبة خلصت (restart) وأنا في الجيم -> ارجع للوبي عشان نبدأ جديد
        if (!gs.started && stepRef.current === 'game') updateStep('lobby');
        
        // Voice Sync
        joinVoiceChat(safePlayers);

      } else { 
        // الغرفة اتمسحت
        updateStep('home'); 
        showToast("الغرفة اتقفلت");
        setRoomId('');
      }
    });
  };

  // --- ACTIONS ---
  const createRoom = () => {
    if(!user) return;
    setLoading(true);
    const newId = Math.floor(1000 + Math.random() * 9000).toString();
    const pData = { id: user.uid, name: user.name, avatarId: selectedAvatarId, peerId: peerId || '' };
    
    // Set disconnect cleanup
    const playerRef = ref(db, `rooms/${newId}/players/${user.uid}`);
    onDisconnect(playerRef).remove();

    set(ref(db, `rooms/${newId}`), { players: { [user.uid]: pData }, gameState: { started: false, admin: user.uid } })
      .then(() => { 
          setRoomId(newId); 
          updateStep('lobby'); 
          listenToRoom(newId); 
          setLoading(false); 
      })
      .catch(() => { showToast("Error creating room"); setLoading(false); });
  };

  const joinRoom = () => {
    if (!roomId) return showToast("اكتب الكود!");
    setLoading(true);
    get(ref(db, `rooms/${roomId}`)).then(ss => {
      if (ss.exists()) {
        const pData = { id: user.uid, name: user.name, avatarId: selectedAvatarId, peerId: peerId || '' };
        
        // Set disconnect cleanup
        const playerRef = ref(db, `rooms/${roomId}/players/${user.uid}`);
        onDisconnect(playerRef).remove();

        update(ref(db, `rooms/${roomId}/players/${user.uid}`), pData).then(() => { 
            updateStep('lobby'); 
            listenToRoom(roomId); 
            setLoading(false); 
        });
      } else { showToast("الكود غلط"); setLoading(false); }
    });
  };

  // --- GAMEPLAY LOGIC (Fixed) ---
  
  // 1. Start Game
  const startGame = () => {
    if(players.length < 3) return showToast("محتاجين 3 لاعبين على الأقل!");
    const cats = { 
        "أفلام": ["الجزيرة", "مافيا", "تيتو", "الفيل الأزرق", "عسل اسود", "الناظر", "اللمبي", "بوحة"], 
        "أكل": ["كشري", "فول", "ملوخية", "محشي", "حواوشي", "كبسة", "سوشي", "بيتزا"],
        "حيوانات": ["أسد", "فيل", "زرافة", "قطة", "كلب", "حمار", "نسر", "تمساح"],
        "دول": ["مصر", "السعودية", "أمريكا", "فرنسا", "المانيا", "اليابان", "الصين", "البرازيل"] 
    };
    const c = Object.keys(cats)[Math.floor(Math.random()*Object.keys(cats).length)];
    const w = cats[c][Math.floor(Math.random()*cats[c].length)];
    const imp = players[Math.floor(Math.random()*players.length)].id;
    const starter = players[Math.floor(Math.random()*players.length)].id;
    
    update(ref(db, `rooms/${roomId}/gameState`), { 
        started: true, 
        category: c, 
        secretWord: w, 
        imposterId: imp, 
        turn: starter, 
        phase: 'selecting', 
        target: null, 
        votes: {}, 
        resultMessage: null 
    });
  };

  // 2. Select Player to Ask
  const handlePlayerClick = (tid) => {
      if (!gameState?.started) return;
      if (gameState.phase === 'voting') return;
      
      // الشروط: لازم يكون دوري، ومختارش نفسي، واللعبة مش في مرحلة إجابة
      if (gameState.turn !== user.uid) return;
      if (tid === user.uid) return showToast("اسأل حد غيرك!", "error");
      
      update(ref(db, `rooms/${roomId}/gameState`), { target: tid, phase: 'answering' });
  };

  // 3. Finish Answering (Pass Turn)
  const finishAnswering = () => {
      // الدور ينتقل للي جاوب، ويرجع يختار تاني
      // Important Fix: The person who was the 'target' becomes the 'turn' owner
      const nextTurn = user.uid; 
      update(ref(db, `rooms/${roomId}/gameState`), { turn: nextTurn, target: null, phase: 'selecting' });
  };

  // 4. Voting Logic
  const startVoting = () => update(ref(db, `rooms/${roomId}/gameState`), { phase: 'voting', votes: {} });

  const castVote = (sid) => {
      const currentVotes = gameState.votes || {};
      if (currentVotes[user.uid]) return showToast("صوتت قبل كدة!", "error");
      
      update(ref(db, `rooms/${roomId}/gameState/votes`), { [user.uid]: sid })
        .then(() => showToast("تم التصويت", "success"));
  };

  const endVotingAndReveal = () => {
      const votes = gameState.votes || {};
      const counts = {};
      Object.values(votes).forEach(v => counts[v] = (counts[v] || 0) + 1);
      
      let max = 0;
      let suspect = null;
      let isTie = false;

      Object.entries(counts).forEach(([id, c]) => { 
          if (c > max) { 
              max = c; 
              suspect = id; 
              isTie = false;
          } else if (c === max) { 
              isTie = true; // Tie detected
          }
      });
      
      let msg = "", winner = "", ejected = suspect;
      
      // Logic Fix: Tie or Skip means nobody ejected
      if (isTie || !suspect || suspect === 'skip') { 
          msg = "تعادل/تخطى! محدش طلع"; 
          winner = "skip"; 
          ejected = null; 
      } else if (suspect === gameState.imposterId) { 
          msg = "مسكتوا الجاسوس! المواطنين كسبوا"; 
          winner = "citizens"; 
      } else { 
          msg = "جاسوس ذكي! طلعتوا واحد بريء"; 
          winner = "imposter"; 
      }

      update(ref(db, `rooms/${roomId}/gameState`), { phase: 'result', resultMessage: msg, winner, ejected });
  };

  // 5. Restart Logic
  const restartRound = () => {
      // Reset everything but keep players
      update(ref(db, `rooms/${roomId}/gameState`), { 
          started: false, 
          phase: null, 
          imposterId: null, 
          votes: null, 
          resultMessage: null, 
          ejected: null,
          secretWord: null
      });
  };

  // --- AUDIO LOGIC (Improved) ---
  const joinVoiceChat = (ps) => { 
      if(!userStream.current) {
          navigator.mediaDevices.getUserMedia({audio:true})
          .then(s => {
              userStream.current = s; 
              connectPeers(ps, s);
          })
          .catch(err => {
              console.warn("No Mic", err);
              connectPeers(ps, null); // Join as listener
          });
      } else { 
          connectPeers(ps, userStream.current); 
      } 
  };

  const connectPeers = (ps, s) => { 
      if (!myPeer.current || myPeer.current.destroyed) return;
      
      ps.forEach(p => { 
          if(p.id !== user?.uid && p.peerId) { 
             if(peersRef.current[p.peerId]) return; // Already connected

             const call = myPeer.current.call(p.peerId, s); 
             if(call) {
                 peersRef.current[p.peerId] = call;
                 call.on('stream', rs => addAudioStream(rs, p.peerId)); 
                 call.on('close', () => { 
                     delete peersRef.current[p.peerId]; 
                     removeAudio(p.peerId); 
                 });
             }
          } 
      }); 
  };

  const addAudioStream = (s, pid) => { 
      if(document.getElementById(`a-${pid}`)) return; 
      const a = document.createElement('audio'); 
      a.srcObject = s; 
      a.id = `a-${pid}`; 
      a.autoplay = true; 
      a.playsInline = true; 
      // Mute local if needed, but generally we want to hear others
      document.body.append(a); 
      a.play().catch(e => console.log("Auto-play blocked", e));
  };
  
  const removeAudio = (pid) => {
      const el = document.getElementById(`a-${pid}`);
      if (el) el.remove();
  };

  const toggleDeafen = (pid) => { 
      const el = document.getElementById(`a-${pid}`); 
      if(el) {
          el.muted = !el.muted; 
          setDeafenedPlayers(p => ({...p, [pid]: !p[pid]})); 
      }
  };

  const toggleMic = () => { 
      if(userStream.current) { 
          const t = userStream.current.getAudioTracks()[0]; 
          if(t) {
             t.enabled = !t.enabled; 
             setIsMuted(!t.enabled); 
          }
      } 
  };

  // --- RENDER HELPERS ---
  const myRole = gameState?.imposterId === user?.uid ? "Imposter (جاسوس)" : "Citizen (مواطن)";
  // Show word if Citizen OR if game ended
  const showSecret = !myRole.includes("Imposter") || gameState?.phase === 'result';
  const myWord = showSecret ? gameState?.secretWord : "؟؟؟";
  
  const CurrentAvatar = AVATARS.find(a => a.id === selectedAvatarId) || AVATARS[0];
  const isVoting = gameState?.phase === 'voting';
  const isResult = gameState?.phase === 'result';

  return (
    <div className={`min-h-screen font-sans transition-colors duration-500 selection:bg-indigo-500 selection:text-white ${darkMode ? 'bg-[#0f172a] text-white' : 'bg-gray-100 text-slate-900'}`}>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #666; border-radius: 10px; }
        @keyframes float { 0% { transform: translateY(0px) rotate(0deg); } 50% { transform: translateY(-20px) rotate(5deg); } 100% { transform: translateY(0px) rotate(0deg); } }
        .eject-anim { animation: float 6s infinite ease-in-out; }
      `}</style>

      {/* TOAST */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-bounce ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'} text-white`}>
          {toast.msg}
        </div>
      )}

      {/* NAVBAR */}
      <div className="absolute top-4 right-4 flex gap-2 z-50">
        <button onClick={() => setDarkMode(!darkMode)} className={`p-3 rounded-full transition hover:scale-110 ${darkMode ? 'bg-slate-800' : 'bg-white shadow-sm'}`}>
           {darkMode ? <Sun size={20}/> : <Moon size={20}/>}
        </button>
        {user && (
          <button onClick={handleLogout} className="p-3 rounded-full bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition">
            <LogOut size={20}/>
          </button>
        )}
      </div>

      {/* VOTING OVERLAY */}
      {isVoting && (
          <div className="fixed inset-0 z-[80] bg-rose-900/95 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in">
              <div className="flex items-center gap-3 mb-8">
                <Megaphone size={40} className="text-white animate-bounce" />
                <h1 className="text-4xl sm:text-5xl font-black text-white uppercase tracking-tighter">اجتماع طارئ</h1>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 w-full max-w-4xl">
                  {players.map(p => {
                      const hasVoted = gameState.votes && gameState.votes[p.id];
                      const meVoted = gameState.votes && gameState.votes[user?.uid] === p.id;
                      return (
                          <div 
                            key={p.id} 
                            onClick={() => castVote(p.id)} 
                            className={`relative bg-slate-800/80 p-3 rounded-2xl border-2 cursor-pointer transition hover:scale-105 group flex flex-col items-center ${meVoted ? 'border-emerald-500 ring-4 ring-emerald-500/50' : 'border-white/10 hover:border-white'}`}
                          >
                              {hasVoted && <div className="absolute top-2 left-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-full z-10">VOTED</div>}
                              <img src={AVATARS.find(a=>a.id===p.avatarId)?.src || AVATARS[0].src} className="w-16 h-16 rounded-xl bg-white/5 mb-2" alt=""/>
                              <span className="font-bold text-white text-sm truncate">{p.name}</span>
                          </div>
                      )
                  })}
              </div>
              <div className="mt-8 flex gap-4">
                  <button onClick={() => castVote('skip')} className="bg-slate-500 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-2 shadow-xl border-b-4 border-slate-700 active:border-b-0 active:translate-y-1">
                    <SkipForward/> Skip
                  </button>
                  {gameState.admin === user?.uid && (
                    <button onClick={endVotingAndReveal} className="bg-emerald-600 text-white px-8 py-4 rounded-xl font-bold shadow-xl border-b-4 border-emerald-800 active:border-b-0 active:translate-y-1">
                      النتيجة
                    </button>
                  )}
              </div>
          </div>
      )}

      {/* RESULT SCREEN */}
      {isResult && (
          <div className="fixed inset-0 z-[90] bg-black flex flex-col items-center justify-center p-4 text-center">
              <div className="mb-8 relative w-full h-64 flex justify-center items-center">
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-50"></div>
                  {gameState.ejected ? (
                    <div className="eject-anim">
                      <img src={AVATARS.find(a => a.id === players.find(p => p.id === gameState.ejected)?.avatarId)?.src || AVATARS[0].src} className="w-40 h-40 drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]" alt="" />
                      <div className="mt-4 text-xl font-bold text-red-500">تم طرده</div>
                    </div>
                  ) : (
                    <div className="text-6xl animate-bounce">🤷‍♂️</div>
                  )}
              </div>
              <h1 className={`text-4xl font-black mb-2 ${gameState.winner === 'citizens' ? 'text-emerald-500' : 'text-rose-500'}`}>
                {gameState.resultMessage}
              </h1>
              <h2 className="text-2xl font-bold text-yellow-400 mb-6">الكلمة كانت: {gameState.secretWord}</h2>

              <div className="bg-white/10 p-6 rounded-3xl backdrop-blur-md max-w-2xl w-full">
                  <h3 className="text-lg font-bold mb-4 border-b border-white/10 pb-2">مين صوت لمين؟</h3>
                  <div className="flex flex-wrap gap-2 justify-center">
                      {players.map(p => {
                          const targetId = gameState.votes ? gameState.votes[p.id] : null;
                          const target = players.find(tp => tp.id === targetId);
                          return (
                            <div key={p.id} className="flex items-center bg-black/40 px-3 py-2 rounded-full gap-2 border border-white/10">
                              <img src={AVATARS.find(a=>a.id===p.avatarId)?.src || AVATARS[0].src} className="w-6 h-6 rounded-full" alt=""/>
                              <span className="text-xs text-white opacity-50">➔</span>
                              {targetId === 'skip' ? (
                                <span className="text-xs font-bold text-slate-400">SKIP</span>
                              ) : target ? (
                                <img src={AVATARS.find(a=>a.id===target.avatarId)?.src || AVATARS[0].src} className="w-6 h-6 rounded-full border border-red-500" alt=""/>
                              ) : (
                                <span className="text-xs text-red-500">?</span>
                              )}
                            </div>
                          )
                      })}
                  </div>
              </div>
              {gameState.admin === user?.uid && (
                <button onClick={restartRound} className="mt-8 bg-white text-black px-8 py-3 rounded-full font-bold text-xl hover:scale-110 transition flex items-center gap-2">
                   جيم جديد <Play fill="black" size={20}/>
                </button>
              )}
          </div>
      )}

      {/* AVATAR MODAL */}
      {showAvatarModal && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-2xl max-h-[80vh] rounded-3xl p-6 overflow-hidden flex flex-col ${darkMode ? 'bg-slate-900 border border-white/10' : 'bg-white'}`}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">اختار شخصيتك</h2>
              <button onClick={() => setShowAvatarModal(false)} className="p-2 rounded-full hover:bg-white/10"><X/></button>
            </div>
            <div className="overflow-y-auto grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3 p-2 custom-scrollbar">
              {AVATARS.map(avatar => (
                <button key={avatar.id} onClick={() => selectAvatar(avatar.id)} className={`p-2 rounded-xl border-2 transition hover:scale-105 flex flex-col items-center gap-2 ${selectedAvatarId === avatar.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-transparent hover:bg-white/5'}`}>
                  <img src={avatar.src} className="w-14 h-14 rounded-full bg-indigo-500/10" loading="lazy" alt="" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CHAT MODAL */}
      {showChatModal && (
        <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
          <div className={`w-full sm:max-w-md h-[80vh] sm:h-[600px] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 ${darkMode ? 'bg-slate-900 border border-white/10' : 'bg-white'}`}>
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-indigo-600 text-white">
              <div className="flex items-center gap-2"><MessageSquare size={20}/><span className="font-bold">Chat</span></div>
              <button onClick={() => setShowChatModal(false)} className="p-1 hover:bg-white/20 rounded-full"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar" ref={chatScrollRef}>
              {messages.length === 0 ? (
                <div className="text-center opacity-50 mt-10 text-sm">ابدأ الشات!</div>
              ) : (
                messages.map((msg, idx) => {
                  const isMe = msg.senderId === user?.uid;
                  return (
                    <div key={idx} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm ${isMe ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-700 text-white rounded-bl-none'}`}>
                        {!isMe && <span className="text-[10px] text-indigo-300 font-bold block mb-1">{msg.senderName}</span>}
                        {msg.text}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <form onSubmit={handleChatSubmit} className="p-3 flex gap-2 border-t border-white/10 bg-slate-800">
              <input className="flex-1 px-4 py-3 rounded-xl outline-none text-sm bg-black/30 text-white" placeholder="اكتب رسالة..." value={chatInput} onChange={e => setChatInput(e.target.value)} />
              <button type="submit" className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition"><Send size={18}/></button>
            </form>
          </div>
        </div>
      )}

      {/* MAIN LAYOUT */}
      <div className="flex flex-col items-center justify-center min-h-screen p-4 relative overflow-hidden">
        
        {/* Chat Toggle */}
        {(step === 'lobby' || step === 'game') && (
          <button onClick={() => {setShowChatModal(true); setHasNewMessage(false)}} className="fixed top-20 right-4 z-40 p-3 rounded-full bg-indigo-600 text-white shadow-lg">
            <MessageSquare size={24}/>
            {hasNewMessage && <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full animate-bounce"></span>}
          </button>
        )}

        <div className="absolute inset-0 pointer-events-none opacity-30">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-indigo-900 via-transparent to-purple-900" />
        </div>

        <div className="z-10 w-full max-w-md">
          
          {/* LOGIN SCREEN */}
          {step === 'login' && (
            <div className={`p-8 rounded-3xl border shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in duration-300 ${darkMode?'bg-slate-900/80 border-white/10':'bg-white'}`}>
              <div className="text-center mb-8">
                <h1 className="text-6xl font-black text-indigo-500">BOR3Y</h1>
                <p className="text-sm mt-2 opacity-50 font-bold">SPY GAME</p>
              </div>
              <div className="space-y-4">
                <input className={`w-full p-4 text-center font-bold rounded-xl outline-none border transition-all ${darkMode ? 'bg-black/30 border-white/10 focus:border-indigo-500' : 'bg-gray-100 focus:border-indigo-500'}`} placeholder="اسمك ايه؟" value={guestName} onChange={e => setGuestName(e.target.value)} disabled={loading} />
                <button onClick={handleGuestLogin} disabled={loading} className="w-full py-4 rounded-xl bg-indigo-600 font-bold text-lg hover:bg-indigo-500 text-white transition disabled:opacity-50">
                  {loading ? <Loader2 className="animate-spin mx-auto"/> : "يلا بينا"}
                </button>
                <button onClick={handleGoogleLogin} disabled={loading} className={`w-full py-4 rounded-xl font-bold border ${darkMode ? 'bg-slate-800 border-white/10' : 'bg-white'}`}>
                  Google Login
                </button>
              </div>
            </div>
          )}
          
          {/* HOME SCREEN */}
          {step === 'home' && (
            <div className={`p-6 rounded-3xl border shadow-2xl text-center ${darkMode?'bg-slate-900/80 border-white/10':'bg-white'}`}>
              <div className="relative inline-block mb-8">
                <img src={CurrentAvatar.src} className="w-24 h-24 rounded-full bg-indigo-500/20" alt="Avatar"/>
                <button onClick={()=>setShowAvatarModal(true)} className="absolute bottom-0 right-0 bg-white text-indigo-600 p-2 rounded-full shadow-lg">
                  <Edit3 size={16}/>
                </button>
              </div>
              <h2 className="text-2xl font-bold mb-8">{user?.name}</h2>
              <div className="space-y-3">
                <button onClick={createRoom} disabled={loading} className="w-full py-5 rounded-2xl bg-indigo-600 text-white font-bold text-xl hover:bg-indigo-500 transition disabled:opacity-50 flex justify-center gap-2">
                  {loading ? <Loader2 className="animate-spin"/> : <><Play fill="white"/> ابدأ اللعب</>}
                </button>
                <div className="flex gap-2">
                  <input className={`flex-1 p-4 rounded-2xl font-mono text-center text-lg outline-none border ${darkMode ? 'bg-black/30 border-white/10' : 'bg-gray-100 border-gray-200'}`} placeholder="CODE" value={roomId} onChange={e => setRoomId(e.target.value)}/>
                  <button onClick={joinRoom} disabled={loading} className={`px-8 rounded-2xl font-bold border ${darkMode ? 'bg-slate-800' : 'bg-gray-200'}`}>
                    {loading ? <Loader2 className="animate-spin"/> : "دخول"}
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* GAME / LOBBY */}
          {(step === 'lobby' || step === 'game') && (
            <div className="w-full">
               <div className="flex justify-between items-center mb-4 px-2">
                 <button onClick={()=>{navigator.clipboard.writeText(roomId);showToast("نسخت الكود", "success")}} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-white">
                   {roomId}<Copy size={14}/>
                 </button>
                 {step === 'game' && !isResult && !isVoting && (
                   <span className="bg-rose-500 text-white px-3 py-1 rounded-full text-xs font-bold animate-pulse">LIVE</span>
                 )}
               </div>

               {step === 'game' && !isResult && !isVoting && (
                  <div className={`p-6 mb-6 rounded-3xl text-center border-4 ${myRole.includes('Imposter')?'border-rose-500 bg-rose-500/10':'border-blue-500 bg-blue-500/10'}`}>
                     <h2 className={`text-4xl font-black mb-2 ${myRole.includes('Imposter')?'text-rose-500':'text-blue-500'}`}>{myRole}</h2>
                     <p className="text-xl font-bold mb-2 opacity-80">القسم: {gameState.category}</p>
                     <p className="text-3xl font-black p-4 bg-black/20 rounded-xl">{myWord}</p>
                     
                     <div className="mt-4">
                        {gameState?.turn === user?.uid && gameState?.phase === 'selecting' && (
                          <div className="bg-emerald-500 text-white px-4 py-2 rounded-xl animate-pulse flex items-center justify-center gap-2">
                            <Search size={18}/> دورك! اسأل حد
                          </div>
                        )}
                        {gameState?.target === user?.uid && gameState?.phase === 'answering' && (
                          <div className="w-full">
                            <div className="bg-indigo-500 text-white px-4 py-2 rounded-xl mb-2 flex items-center justify-center gap-2">
                              <Mic size={18}/> جاوب!
                            </div>
                            <button onClick={finishAnswering} className="bg-white text-black px-6 py-2 rounded-full font-bold shadow-lg active:scale-95 transition">
                              خلصت إجابة
                            </button>
                          </div>
                        )}
                     </div>
                  </div>
               )}

               <div className="grid grid-cols-1 gap-3 mb-24">
                  {players.map(p => (
                     <div 
                       key={p.id} 
                       onClick={() => handlePlayerClick(p.id)} 
                       className={`relative p-3 rounded-2xl flex items-center justify-between border-2 transition-all duration-300
                         ${gameState?.turn===p.id ? 'border-emerald-500 bg-emerald-500/10 scale-105 shadow-lg z-10' : 
                           gameState?.target===p.id ? 'border-indigo-500 bg-indigo-500/10 scale-105 shadow-lg z-10' : 
                           darkMode ? 'border-white/5 bg-slate-900/50' : 'border-gray-100 bg-white shadow-sm'}
                       `}
                     >
                        {gameState?.turn === p.id && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] px-2 rounded-full">بيسأل</div>}
                        {gameState?.target === p.id && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-[10px] px-2 rounded-full">بيجاوب</div>}
                        
                        <div className="flex items-center gap-4">
                          <img src={AVATARS.find(a=>a.id===p.avatarId)?.src || AVATARS[0].src} className="w-12 h-12 rounded-xl bg-white/5" alt=""/>
                          <div>
                            <span className="font-bold text-lg block">{p.name}</span>
                            {gameState.admin === p.id && <span className="text-[10px] text-yellow-500 flex items-center gap-1"><Crown size={10}/> ADMIN</span>}
                          </div>
                        </div>
                        {!isVoting && !isResult && p.id!==user?.uid && (
                          <button onClick={(e)=>{e.stopPropagation();toggleDeafen(p.peerId)}} className={`p-3 rounded-full transition ${deafenedPlayers[p.peerId] ? 'bg-rose-500 text-white' : 'bg-white/10 hover:bg-white/20'}`}>
                            {deafenedPlayers[p.peerId] ? <VolumeX size={18}/> : <Volume2 size={18}/>}
                          </button>
                        )}
                     </div>
                  ))}
               </div>

               <div className="fixed bottom-6 left-0 w-full flex justify-center gap-4 z-50 px-4">
                  {!isVoting && !isResult && (
                    <button onClick={toggleMic} className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl border-4 transition active:scale-90 ${isMuted?'bg-slate-800 border-rose-500 text-rose-500':'bg-white border-emerald-500 text-emerald-600'}`}>
                      {isMuted ? <MicOff size={28}/> : <Mic size={28}/>}
                    </button>
                  )}
                  {gameState?.admin === user?.uid && (
                      <div className="flex gap-2">
                          {step === 'lobby' ? (
                            <button onClick={startGame} className="h-16 px-8 rounded-full font-black text-lg bg-emerald-600 text-white shadow-lg active:scale-95 transition">
                              ابدأ الجيم
                            </button>
                          ) : !isResult && !isVoting && (
                            <button onClick={startVoting} className="h-16 w-16 rounded-full bg-rose-600 text-white flex items-center justify-center border-4 border-rose-800 shadow-lg active:scale-95 transition">
                              <Vote size={24}/>
                            </button>
                          )}
                      </div>
                  )}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;