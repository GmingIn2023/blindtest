// Configuration Firebase (à remplacer par la tienne)
const firebaseConfig = {
  apiKey: "AIzaSyBOEU9kg6YuXllGEGS9iod_SsBRu9NOPro",
  authDomain: "blind-test-kahoot.firebaseapp.com",
  databaseURL: "https://blind-test-kahoot-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "blind-test-kahoot",
  storageBucket: "blind-test-kahoot.firebasestorage.app",
  messagingSenderId: "798773649205",
  appId: "1:798773649205:web:de5dd5cbce41ea2ec5b67c"
};

// Initialiser Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
console.log("🔥 Firebase initialisé");

// Exporter db pour l'utiliser dans les autres scripts
window.db = db;
