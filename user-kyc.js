/* =========================================================
   DahabiPay — User KYC (public submission form)
   ONE clean implementation. No Firebase Authentication, no
   login/account/activation of any kind. Firestore ONLY — no
   Firebase Storage. All documents/selfie are compressed and
   stored as Base64 data URLs directly inside the Firestore
   document. No duplicate camera, state, loading, or
   submission logic anywhere in this file.
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCea4VWLAyCDf0aX0X12kydFOOf840FROIA",
  authDomain: "dahabipay-kyc.firebaseapp.com",
  projectId: "dahabipay-kyc",
  storageBucket: "dahabipay-kyc.firebasestorage.app",
  messagingSenderId: "760281015505",
  appId: "1:760281015505:web:556b760f75fbe265d211f0",
  measurementId: "G-26B9M7B85Q"
};

const FIREBASE_SDK_VERSION = "10.12.2";
const FACEAPI_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const FACEAPI_MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

const ALLOWED_FILE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/* ---------------------------------------------------------
   Image compression budget. Firestore's hard document limit
   is 1,048,576 bytes (1 MiB). We keep the combined size of
   the three embedded images well under that, leaving generous
   headroom for the rest of the document's text fields.
   --------------------------------------------------------- */
const TARGET_ID_IMAGE_BYTES = 260 * 1024;
const TARGET_SELFIE_IMAGE_BYTES = 180 * 1024;
const MAX_COMBINED_IMAGE_BYTES = 820 * 1024;
const FIRESTORE_HARD_LIMIT_BYTES = 1048576;
const FIRESTORE_SAFE_LIMIT_BYTES = 1000000;
const MIN_ID_DIMENSION = 700;
const MIN_SELFIE_DIMENSION = 320;
const MIN_QUALITY = 0.35;

/* Document types that typically carry information on both sides.
   Passport has no such back page, so its back upload stays optional. */
function requiresBackId(idType) {
  return idType === "national_id" || idType === "drivers_license" || idType === "residence_permit";
}

/* ===========================================================
   COUNTRY / NATIONALITY LIST (shared by both dropdowns)
   =========================================================== */
const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia",
  "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
  "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
  "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad",
  "Chile", "China", "Colombia", "Comoros", "Congo (Republic of the)", "Congo (Democratic Republic of the)",
  "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominica", "Dominican Republic",
  "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji",
  "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala",
  "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran",
  "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo",
  "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania",
  "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania",
  "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
  "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
  "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama",
  "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia",
  "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
  "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
  "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "Somaliland","South Africa", "South Korea", "South Sudan", "Spain",
  "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania",
  "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan",
  "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
  "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

/* ===========================================================
   COUNTRY DIAL CODES (name kept in sync with COUNTRIES above)
   =========================================================== */
const DIAL_CODES = [
  { name: "Afghanistan", code: "+93" }, { name: "Albania", code: "+355" }, { name: "Algeria", code: "+213" },
  { name: "Andorra", code: "+376" }, { name: "Angola", code: "+244" }, { name: "Antigua and Barbuda", code: "+1" },
  { name: "Argentina", code: "+54" }, { name: "Armenia", code: "+374" }, { name: "Australia", code: "+61" },
  { name: "Austria", code: "+43" }, { name: "Azerbaijan", code: "+994" }, { name: "Bahamas", code: "+1" },
  { name: "Bahrain", code: "+973" }, { name: "Bangladesh", code: "+880" }, { name: "Barbados", code: "+1" },
  { name: "Belarus", code: "+375" }, { name: "Belgium", code: "+32" }, { name: "Belize", code: "+501" },
  { name: "Benin", code: "+229" }, { name: "Bhutan", code: "+975" }, { name: "Bolivia", code: "+591" },
  { name: "Bosnia and Herzegovina", code: "+387" }, { name: "Botswana", code: "+267" }, { name: "Brazil", code: "+55" },
  { name: "Brunei", code: "+673" }, { name: "Bulgaria", code: "+359" }, { name: "Burkina Faso", code: "+226" },
  { name: "Burundi", code: "+257" }, { name: "Cabo Verde", code: "+238" }, { name: "Cambodia", code: "+855" },
  { name: "Cameroon", code: "+237" }, { name: "Canada", code: "+1" }, { name: "Central African Republic", code: "+236" },
  { name: "Chad", code: "+235" }, { name: "Chile", code: "+56" }, { name: "China", code: "+86" },
  { name: "Colombia", code: "+57" }, { name: "Comoros", code: "+269" }, { name: "Congo (Republic of the)", code: "+242" },
  { name: "Congo (Democratic Republic of the)", code: "+243" }, { name: "Costa Rica", code: "+506" },
  { name: "Croatia", code: "+385" }, { name: "Cuba", code: "+53" }, { name: "Cyprus", code: "+357" },
  { name: "Czechia", code: "+420" }, { name: "Denmark", code: "+45" }, { name: "Djibouti", code: "+253" },
  { name: "Dominica", code: "+1" }, { name: "Dominican Republic", code: "+1" }, { name: "Ecuador", code: "+593" },
  { name: "Egypt", code: "+20" }, { name: "El Salvador", code: "+503" }, { name: "Equatorial Guinea", code: "+240" },
  { name: "Eritrea", code: "+291" }, { name: "Estonia", code: "+372" }, { name: "Eswatini", code: "+268" },
  { name: "Ethiopia", code: "+251" }, { name: "Fiji", code: "+679" }, { name: "Finland", code: "+358" },
  { name: "France", code: "+33" }, { name: "Gabon", code: "+241" }, { name: "Gambia", code: "+220" },
  { name: "Georgia", code: "+995" }, { name: "Germany", code: "+49" }, { name: "Ghana", code: "+233" },
  { name: "Greece", code: "+30" }, { name: "Grenada", code: "+1" }, { name: "Guatemala", code: "+502" },
  { name: "Guinea", code: "+224" }, { name: "Guinea-Bissau", code: "+245" }, { name: "Guyana", code: "+592" },
  { name: "Haiti", code: "+509" }, { name: "Honduras", code: "+504" }, { name: "Hungary", code: "+36" },
  { name: "Iceland", code: "+354" }, { name: "India", code: "+91" }, { name: "Indonesia", code: "+62" },
  { name: "Iran", code: "+98" }, { name: "Iraq", code: "+964" }, { name: "Ireland", code: "+353" },
  { name: "Israel", code: "+972" }, { name: "Italy", code: "+39" }, { name: "Jamaica", code: "+1" },
  { name: "Japan", code: "+81" }, { name: "Jordan", code: "+962" }, { name: "Kazakhstan", code: "+7" },
  { name: "Kenya", code: "+254" }, { name: "Kiribati", code: "+686" }, { name: "Kosovo", code: "+383" },
  { name: "Kuwait", code: "+965" }, { name: "Kyrgyzstan", code: "+996" }, { name: "Laos", code: "+856" },
  { name: "Latvia", code: "+371" }, { name: "Lebanon", code: "+961" }, { name: "Lesotho", code: "+266" },
  { name: "Liberia", code: "+231" }, { name: "Libya", code: "+218" }, { name: "Liechtenstein", code: "+423" },
  { name: "Lithuania", code: "+370" }, { name: "Luxembourg", code: "+352" }, { name: "Madagascar", code: "+261" },
  { name: "Malawi", code: "+265" }, { name: "Malaysia", code: "+60" }, { name: "Maldives", code: "+960" },
  { name: "Mali", code: "+223" }, { name: "Malta", code: "+356" }, { name: "Marshall Islands", code: "+692" },
  { name: "Mauritania", code: "+222" }, { name: "Mauritius", code: "+230" }, { name: "Mexico", code: "+52" },
  { name: "Micronesia", code: "+691" }, { name: "Moldova", code: "+373" }, { name: "Monaco", code: "+377" },
  { name: "Mongolia", code: "+976" }, { name: "Montenegro", code: "+382" }, { name: "Morocco", code: "+212" },
  { name: "Mozambique", code: "+258" }, { name: "Myanmar", code: "+95" }, { name: "Namibia", code: "+264" },
  { name: "Nauru", code: "+674" }, { name: "Nepal", code: "+977" }, { name: "Netherlands", code: "+31" },
  { name: "New Zealand", code: "+64" }, { name: "Nicaragua", code: "+505" }, { name: "Niger", code: "+227" },
  { name: "Nigeria", code: "+234" }, { name: "North Korea", code: "+850" }, { name: "North Macedonia", code: "+389" },
  { name: "Norway", code: "+47" }, { name: "Oman", code: "+968" }, { name: "Pakistan", code: "+92" },
  { name: "Palau", code: "+680" }, { name: "Palestine", code: "+970" }, { name: "Panama", code: "+507" },
  { name: "Papua New Guinea", code: "+675" }, { name: "Paraguay", code: "+595" }, { name: "Peru", code: "+51" },
  { name: "Philippines", code: "+63" }, { name: "Poland", code: "+48" }, { name: "Portugal", code: "+351" },
  { name: "Qatar", code: "+974" }, { name: "Romania", code: "+40" }, { name: "Russia", code: "+7" },
  { name: "Rwanda", code: "+250" }, { name: "Saint Kitts and Nevis", code: "+1" }, { name: "Saint Lucia", code: "+1" },
  { name: "Saint Vincent and the Grenadines", code: "+1" }, { name: "Samoa", code: "+685" },
  { name: "San Marino", code: "+378" }, { name: "Sao Tome and Principe", code: "+239" },
  { name: "Saudi Arabia", code: "+966" }, { name: "Senegal", code: "+221" }, { name: "Serbia", code: "+381" },
  { name: "Seychelles", code: "+248" }, { name: "Sierra Leone", code: "+232" }, { name: "Singapore", code: "+65" },
  { name: "Slovakia", code: "+421" }, { name: "Slovenia", code: "+386" }, { name: "Solomon Islands", code: "+677" },
  { name: "Somalia", code: "+252" },  { name: "Somaliland", code: "+252" },  { name: "South Africa", code: "+27" }, { name: "South Korea", code: "+82" },
  { name: "South Sudan", code: "+211" }, { name: "Spain", code: "+34" }, { name: "Sri Lanka", code: "+94" },
  { name: "Sudan", code: "+249" }, { name: "Suriname", code: "+597" }, { name: "Sweden", code: "+46" },
  { name: "Switzerland", code: "+41" }, { name: "Syria", code: "+963" }, { name: "Taiwan", code: "+886" },
  { name: "Tajikistan", code: "+992" }, { name: "Tanzania", code: "+255" }, { name: "Thailand", code: "+66" },
  { name: "Timor-Leste", code: "+670" }, { name: "Togo", code: "+228" }, { name: "Tonga", code: "+676" },
  { name: "Trinidad and Tobago", code: "+1" }, { name: "Tunisia", code: "+216" }, { name: "Turkey", code: "+90" },
  { name: "Turkmenistan", code: "+993" }, { name: "Tuvalu", code: "+688" }, { name: "Uganda", code: "+256" },
  { name: "Ukraine", code: "+380" }, { name: "United Arab Emirates", code: "+971" }, { name: "United Kingdom", code: "+44" },
  { name: "United States", code: "+1" }, { name: "Uruguay", code: "+598" }, { name: "Uzbekistan", code: "+998" },
  { name: "Vanuatu", code: "+678" }, { name: "Vatican City", code: "+379" }, { name: "Venezuela", code: "+58" },
  { name: "Vietnam", code: "+84" }, { name: "Yemen", code: "+967" }, { name: "Zambia", code: "+260" },
  { name: "Zimbabwe", code: "+263" }
];

/* Populates a <select> from a plain string list, appended after
   whatever placeholder option already exists in the HTML. Pure
   synchronous DOM work — never touches the loading overlay. */
function populateCountrySelect(selectEl) {
  const frag = document.createDocumentFragment();
  COUNTRIES.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    frag.appendChild(opt);
  });
  selectEl.appendChild(frag);
}

/* Populates the dial-code <select> as "Country (+Code)" options,
   value is just the numeric code (e.g. "+252"). */
function populateDialCodeSelect(selectEl) {
  const frag = document.createDocumentFragment();
  DIAL_CODES.forEach(({ name, code }) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${name} (${code})`;
    frag.appendChild(opt);
  });
  selectEl.appendChild(frag);
}

/* ---------------------------------------------------------
   Firebase handles (populated once, in initFirebase).
   Firestore ONLY — no Storage, no Auth is imported or used
   anywhere in this file.
   --------------------------------------------------------- */
let db;
let fnDoc, fnGetDoc, fnSetDoc, fnServerTimestamp;

/* ---------------------------------------------------------
   Single application state
   --------------------------------------------------------- */
const state = {
  currentStep: 1,
  totalSteps: 6,
  submitting: false,
  personal: { fullName: "", dateOfBirth: "", gender: "", nationality: "", countryOfResidence: "", city: "" },
  contact: { dialCode: "", whatsappNumber: "", email: "", address: "" },
  identity: { idType: "", idNumber: "", idExpiry: "" },
  files: { front: null, back: null },
  selfieCanvas: null,
  camera: {
    stream: null,
    detectInterval: null,
    rafId: null,
    modelsLoaded: false,
    active: false,
    detecting: false,
    sequence: ["center", "left", "center", "right", "center"],
    sequenceIndex: 0,
    holdFrames: 0,
    requiredHold: 5,
    verification: {
      faceDetected: false,
      singleFace: false,
      faceCentered: false,
      livenessCompleted: false
    }
  }
};

/* ===========================================================
   LOADING OVERLAY — the ONLY function allowed to control it.
   This is called with `true` in exactly one place in the
   entire file: inside handleSubmit(), after the user presses
   "Submit verification". It is never called with `true`
   during page load, DOMContentLoaded, Firebase init, country
   list population, nationality list population, step
   navigation, camera start, or face-model loading.
   =========================================================== */
const loadingEl = document.getElementById("loading");
const loadingTextEl = document.getElementById("loadingText");
function setLoading(show, message = "Submitting your verification...") {
  loadingEl.hidden = !show;
  if (loadingTextEl && message) loadingTextEl.textContent = message;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ===========================================================
   FIREBASE INIT (Firestore only — no Auth, no Storage)
   Runs in the background; the wizard is already visible and
   usable while this resolves, so it never blocks the page.
   =========================================================== */
async function initFirebase() {
  try {
    const [appMod, fsMod] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`)
    ]);

    const app = appMod.initializeApp(firebaseConfig);
    db = fsMod.getFirestore(app);

    fnDoc = fsMod.doc;
    fnGetDoc = fsMod.getDoc;
    fnSetDoc = fsMod.setDoc;
    fnServerTimestamp = fsMod.serverTimestamp;

    return true;
  } catch (err) {
    console.error("Firebase initialization failed:", err);
    return false;
  }
}

/* ===========================================================
   TOAST
   =========================================================== */
let toastTimer = null;
function toast(message, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast is-visible" + (type === "error" ? " is-error" : type === "success" ? " is-success" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 3800);
}

/* ===========================================================
   FIELD ERROR HELPERS
   =========================================================== */
function setError(fieldId, message) {
  const errEl = document.getElementById("err-" + fieldId);
  if (errEl) errEl.textContent = message;
  const input = document.getElementById(fieldId);
  const wrap = input ? input.closest(".field") : null;
  if (wrap) wrap.classList.add("has-error");
}
function clearError(fieldId) {
  const errEl = document.getElementById("err-" + fieldId);
  if (errEl) errEl.textContent = "";
  const input = document.getElementById(fieldId);
  const wrap = input ? input.closest(".field") : null;
  if (wrap) wrap.classList.remove("has-error");
}
function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

/* ===========================================================
   STEP NAVIGATION
   =========================================================== */
function goToStep(n) {
  const prev = state.currentStep;

  if (prev === 5 && n !== 5) {
    if (state.selfieCanvas) {
      stopCamera();
    } else {
      resetCameraState();
    }
  }

  document.querySelectorAll(".step").forEach((el) => {
    el.hidden = Number(el.dataset.step) !== n;
  });

  state.currentStep = n;
  updateStepperUI(n);

  document.getElementById("btnBack").hidden = n === 1;
  const isLast = n === state.totalSteps;
  document.getElementById("btnContinue").hidden = isLast;
  document.getElementById("btnSubmit").hidden = !isLast;

  if (n === 4) syncBackRequiredUI();
  if (n === 5) enterStep5();
  if (n === 6) renderReview();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateStepperUI(n) {
  document.querySelectorAll(".stepper__item").forEach((item) => {
    const s = Number(item.dataset.step);
    item.classList.toggle("is-active", s === n);
    item.classList.toggle("is-done", s < n);
  });
  const pct = ((n - 1) / (state.totalSteps - 1)) * 100;
  document.getElementById("stepperFill").style.width = pct + "%";
}

function onContinueClick() {
  const step = state.currentStep;
  const validators = { 1: validateStep1, 2: validateStep2, 3: validateStep3, 4: validateStep4, 5: validateStep5 };
  const fn = validators[step];
  if (fn && !fn()) {
    toast("Please fix the highlighted fields.", "error");
    return;
  }
  goToStep(step + 1);
}

function onSubmitClick() {
  if (!validateStep6()) {
    toast("Please confirm both declarations.", "error");
    return;
  }
  handleSubmit();
}

function wireNav() {
  document.getElementById("btnContinue").addEventListener("click", onContinueClick);
  document.getElementById("btnBack").addEventListener("click", () => goToStep(state.currentStep - 1));
  document.getElementById("btnSubmit").addEventListener("click", onSubmitClick);
}

/* ===========================================================
   VALIDATION
   =========================================================== */
function readFormIntoState() {
  state.personal.fullName = val("fullName").trim();
  state.personal.dateOfBirth = val("dateOfBirth");
  state.personal.gender = val("gender");
  state.personal.nationality = val("nationality");
  state.personal.countryOfResidence = val("countryOfResidence");
  state.personal.city = val("city").trim();

  state.contact.dialCode = val("dialCode");
  state.contact.whatsappNumber = val("whatsappNumber").replace(/\s+/g, "");
  state.contact.email = val("email").trim();
  state.contact.address = val("address").trim();

  state.identity.idType = val("idType");
  state.identity.idNumber = val("idNumber").trim();
  state.identity.idExpiry = val("idExpiry");
}

function calcAge(dateStr) {
  const dob = new Date(dateStr);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  if (dob > today) return null;
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function validateStep1() {
  readFormIntoState();
  let ok = true;
  ["fullName", "dateOfBirth", "gender", "nationality", "countryOfResidence", "city"].forEach(clearError);

  if (!state.personal.fullName || state.personal.fullName.length < 3) {
    setError("fullName", "Please enter your full legal name.");
    ok = false;
  }
  if (!state.personal.dateOfBirth) {
    setError("dateOfBirth", "Date of birth is required.");
    ok = false;
  } else {
    const age = calcAge(state.personal.dateOfBirth);
    if (age === null) {
      setError("dateOfBirth", "Please enter a valid date.");
      ok = false;
    } else if (age < 18) {
      setError("dateOfBirth", "You must be at least 18 years old.");
      ok = false;
    }
  }
  if (state.personal.gender !== "male" && state.personal.gender !== "female") {
    setError("gender", "Please select your gender.");
    ok = false;
  }
  if (!state.personal.nationality) {
    setError("nationality", "Please select your nationality.");
    ok = false;
  }
  if (!state.personal.countryOfResidence) {
    setError("countryOfResidence", "Please select your country of residence.");
    ok = false;
  }
  if (!state.personal.city) {
    setError("city", "City is required.");
    ok = false;
  }
  return ok;
}

function validateStep2() {
  readFormIntoState();
  let ok = true;
  ["dialCode", "whatsappNumber", "email", "address"].forEach(clearError);

  if (!state.contact.dialCode) {
    setError("dialCode", "Please select your country code.");
    ok = false;
  }
  if (!/^[0-9]{6,12}$/.test(state.contact.whatsappNumber)) {
    setError("whatsappNumber", "Enter a valid WhatsApp number.");
    ok = false;
  }
  if (state.contact.email) {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.contact.email);
    if (!emailOk) {
      setError("email", "Enter a valid email address.");
      ok = false;
    }
  }
  if (!state.contact.address || state.contact.address.length < 10) {
    setError("address", "Please enter your full residential address.");
    ok = false;
  }
  return ok;
}

function validateStep3() {
  readFormIntoState();
  let ok = true;
  ["idType", "idNumber", "idExpiry"].forEach(clearError);

  if (!state.identity.idType) {
    setError("idType", "Please select a document type.");
    ok = false;
  }
  if (!state.identity.idNumber || state.identity.idNumber.length < 4) {
    setError("idNumber", "Please enter a valid document number.");
    ok = false;
  }
  if (state.identity.idExpiry) {
    const exp = new Date(state.identity.idExpiry);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!isNaN(exp.getTime()) && exp < today) {
      setError("idExpiry", "This document has expired.");
      ok = false;
    }
  }
  return ok;
}

function syncBackRequiredUI() {
  const tag = document.getElementById("backOptionalTag");
  if (requiresBackId(state.identity.idType)) {
    tag.textContent = "(required for this document type)";
    tag.classList.remove("opt");
    tag.classList.add("req");
  } else {
    tag.textContent = "(optional)";
    tag.classList.remove("req");
    tag.classList.add("opt");
  }
}

function validateStep4() {
  clearError("fileFront");
  clearError("fileBack");
  let ok = true;
  if (!state.files.front) {
    setError("fileFront", "Please upload the front of your document.");
    ok = false;
  }
  if (requiresBackId(state.identity.idType) && !state.files.back) {
    setError("fileBack", "This document type requires a photo of the back as well.");
    ok = false;
  }
  return ok;
}

function validateStep5() {
  clearError("selfie");
  if (!state.selfieCanvas || !state.camera.verification.livenessCompleted) {
    setError("selfie", "Please complete the live face verification.");
    return false;
  }
  return true;
}

function validateStep6() {
  clearError("declarations");
  const a = document.getElementById("declareTrue").checked;
  const b = document.getElementById("declareAgree").checked;
  if (!a || !b) {
    setError("declarations", "Please confirm both declarations to continue.");
    return false;
  }
  return true;
}

function wireDeclarations() {
  ["declareTrue", "declareAgree"].forEach((id) => {
    document.getElementById(id).addEventListener("change", updateSubmitButtonState);
  });
}
function updateSubmitButtonState() {
  const a = document.getElementById("declareTrue").checked;
  const b = document.getElementById("declareAgree").checked;
  document.getElementById("btnSubmit").disabled = !(a && b) || state.submitting;
}

/* ===========================================================
   FILE UPLOAD (Step 4) — files are kept in memory only;
   nothing is compressed or converted until final submission.
   =========================================================== */
function setupUploader(key) {
  const inputId = key === "front" ? "fileFront" : "fileBack";
  const errId = inputId;
  const input = document.getElementById(inputId);
  const pickBtn = document.getElementById(`btnPick-${key}`);
  const replaceBtn = document.getElementById(`btnReplace-${key}`);
  const removeBtn = document.getElementById(`btnRemove-${key}`);
  const wrap = document.getElementById(`uploader-${key}`);

  pickBtn.addEventListener("click", () => input.click());
  replaceBtn.addEventListener("click", () => input.click());
  removeBtn.addEventListener("click", () => clearFile(key));

  input.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFileSelected(key, file, errId);
    input.value = "";
  });

  wrap.addEventListener("dragover", (e) => {
    e.preventDefault();
    wrap.classList.add("is-dragover");
  });
  wrap.addEventListener("dragleave", () => wrap.classList.remove("is-dragover"));
  wrap.addEventListener("drop", (e) => {
    e.preventDefault();
    wrap.classList.remove("is-dragover");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFileSelected(key, file, errId);
  });
}

function handleFileSelected(key, file, errId) {
  clearError(errId);
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    setError(errId, "Please upload a JPG, PNG or WEBP image.");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setError(errId, "File is too large. Maximum size is 8MB.");
    return;
  }
  state.files[key] = { file, name: file.name };

  const imgEl = document.getElementById(`previewImg-${key}`);
  if (imgEl.src) URL.revokeObjectURL(imgEl.src);
  imgEl.src = URL.createObjectURL(file);

  document.getElementById(`uploaderEmpty-${key}`).hidden = true;
  document.getElementById(`uploaderPreview-${key}`).hidden = false;
}

function clearFile(key) {
  state.files[key] = null;
  const imgEl = document.getElementById(`previewImg-${key}`);
  if (imgEl.src) URL.revokeObjectURL(imgEl.src);
  imgEl.src = "";
  document.getElementById(`uploaderEmpty-${key}`).hidden = false;
  document.getElementById(`uploaderPreview-${key}`).hidden = true;
}

/* ===========================================================
   CAMERA MANAGEMENT (single implementation, Step 5 only).
   The camera never starts on page load — only when the user
   reaches Step 5 and taps "Enable camera". It always stops
   when leaving Step 5 and restarts safely on return.
   =========================================================== */
function wireCamera() {
  document.getElementById("btnStartCamera").addEventListener("click", startCamera);
  document.getElementById("btnRetake").addEventListener("click", retakeSelfie);
}

function enterStep5() {
  hideCameraError();
  if (state.selfieCanvas) {
    document.getElementById("video").hidden = true;
    document.getElementById("selfiePreview").hidden = false;
    document.getElementById("livenessRing").hidden = true;
    document.getElementById("cameraControlsRetake").hidden = false;
    document.getElementById("cameraControlsStart").hidden = true;
    setCameraInstruction("Selfie captured.");
    setCameraStatus("Looks good.");
  } else {
    document.getElementById("video").hidden = false;
    document.getElementById("selfiePreview").hidden = true;
    document.getElementById("cameraControlsStart").hidden = false;
    document.getElementById("cameraControlsRetake").hidden = true;
    setCameraInstruction('Tap "Enable camera" to begin face verification.');
    setCameraStatus("");
  }
}

async function ensureFaceApiLoaded() {
  if (window.faceapi) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = FACEAPI_SCRIPT_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Face verification library failed to load. Please check your connection and try again."));
    document.head.appendChild(s);
  });
}

async function loadFaceModels() {
  if (state.camera.modelsLoaded) return;
  await ensureFaceApiLoaded();
  await Promise.all([
    window.faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL),
    window.faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACEAPI_MODEL_URL)
  ]);
  state.camera.modelsLoaded = true;
}

async function startCamera() {
  hideCameraError();
  setCameraInstruction("Starting camera…");
  document.getElementById("cameraControlsStart").hidden = true;

  if (!window.isSecureContext) {
    showCameraError("Camera access requires a secure connection (HTTPS). Please reload the page over HTTPS.");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraError("Your browser does not support camera access. Please try a different or updated browser.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } },
      audio: false
    });
    state.camera.stream = stream;

    const video = document.getElementById("video");
    video.srcObject = stream;
    await video.play();

    document.getElementById("selfiePreview").hidden = true;
    video.hidden = false;
    document.getElementById("livenessRing").hidden = false;

    setCameraInstruction("Loading face verification…");
    await loadFaceModels();

    resetLivenessProgress();
    setCameraInstruction(instructionForSequenceIndex(0));
    setCameraStatus("Position your face in the circle.");

    state.camera.active = true;
    state.camera.detectInterval = setInterval(detectFace, 250);
  } catch (err) {
    console.error("Camera error:", err);
    handleCameraError(err);
  }
}

function handleCameraError(err) {
  let msg = "We could not access your camera. Please try again.";
  if (err) {
    if (err.name === "NotAllowedError") {
      msg = "Camera access was denied. Please allow camera permission in your browser settings and try again.";
    } else if (err.name === "NotFoundError") {
      msg = "No camera was found on this device.";
    } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      msg = "Your camera is already in use by another application.";
    } else if (err.name === "OverconstrainedError") {
      msg = "Your camera does not support the required settings.";
    } else if (err.message) {
      msg = err.message;
    }
  }
  showCameraError(msg);
  document.getElementById("cameraControlsStart").hidden = false;
  document.getElementById("video").hidden = true;
  document.getElementById("livenessRing").hidden = true;
}

function stopCamera() {
  if (state.camera.detectInterval) {
    clearInterval(state.camera.detectInterval);
    state.camera.detectInterval = null;
  }
  if (state.camera.rafId) {
    cancelAnimationFrame(state.camera.rafId);
    state.camera.rafId = null;
  }
  if (state.camera.stream) {
    state.camera.stream.getTracks().forEach((t) => t.stop());
    state.camera.stream = null;
  }
  const video = document.getElementById("video");
  if (video) video.srcObject = null;
  state.camera.active = false;
}

function resetCameraState() {
  stopCamera();
  resetLivenessProgress();
}

function resetLivenessProgress() {
  state.camera.sequenceIndex = 0;
  state.camera.holdFrames = 0;
  state.camera.verification = {
    faceDetected: false,
    singleFace: false,
    faceCentered: false,
    livenessCompleted: false
  };
  updateRingProgress();
}

async function detectFace() {
  if (state.camera.detecting || !state.camera.active || !window.faceapi) return;
  state.camera.detecting = true;
  try {
    const video = document.getElementById("video");
    if (!video || video.readyState < 2) return;
    const options = new window.faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
    const detections = await window.faceapi.detectAllFaces(video, options).withFaceLandmarks(true);
    processFaceDetection(detections, video);
  } catch (err) {
    console.error("Face detection error:", err);
  } finally {
    state.camera.detecting = false;
  }
}

/* Coarse head-turn estimate from 68-point landmarks (jaw contour vs nose
   tip). This is only a liveness/gesture check, not precision 3D pose
   estimation — browser face detection like this is not a guarantee
   against spoofing. */
function estimateHeadTurn(landmarks) {
  const pts = landmarks.positions;
  const jawLeft = pts[0];
  const jawRight = pts[16];
  const noseTip = pts[30];
  const faceWidth = Math.max(1, jawRight.x - jawLeft.x);
  const ratio = (noseTip.x - jawLeft.x) / faceWidth;
  if (ratio < 0.38) return "right";
  if (ratio > 0.62) return "left";
  return "center";
}

function processFaceDetection(detections, video) {
  const v = state.camera.verification;

  if (!detections || detections.length === 0) {
    v.faceDetected = false;
    v.singleFace = false;
    v.faceCentered = false;
    setCameraStatus("No face detected — center your face in the circle.");
    return;
  }
  if (detections.length > 1) {
    v.faceDetected = true;
    v.singleFace = false;
    setCameraStatus("Only one person should be in frame.");
    return;
  }

  v.faceDetected = true;
  v.singleFace = true;

  const det = detections[0];
  const box = det.detection.box;
  const vw = video.videoWidth || 480;
  const vh = video.videoHeight || 480;
  const faceCenterX = box.x + box.width / 2;
  const faceCenterY = box.y + box.height / 2;
  const dx = Math.abs(faceCenterX - vw / 2) / vw;
  const dy = Math.abs(faceCenterY - vh / 2) / vh;
  v.faceCentered = dx < 0.2 && dy < 0.22;

  if (!v.faceCentered) {
    setCameraStatus("Center your face inside the circle.");
    return;
  }

  setCameraStatus("");
  const turn = estimateHeadTurn(det.landmarks);
  updateLiveness(turn);
}

function instructionForSequenceIndex(i, holding) {
  const map = [
    "Look straight at the camera.",
    "Slowly turn your head LEFT.",
    "Return to CENTER.",
    "Slowly turn your head RIGHT.",
    "Return to CENTER and hold still."
  ];
  const text = map[i] || "Hold still…";
  return holding ? `${text} Hold…` : text;
}

function updateLiveness(turn) {
  const cam = state.camera;
  const expected = cam.sequence[cam.sequenceIndex];

  if (turn === expected) {
    cam.holdFrames = Math.min(cam.requiredHold, cam.holdFrames + 1);
  } else {
    cam.holdFrames = Math.max(0, cam.holdFrames - 1);
  }

  updateRingProgress();

  if (cam.holdFrames >= cam.requiredHold) {
    cam.sequenceIndex++;
    cam.holdFrames = 0;

    if (cam.sequenceIndex >= cam.sequence.length) {
      state.camera.verification.livenessCompleted = true;
      setCameraInstruction("Hold still — capturing…");
      captureSelfie();
      return;
    }
    setCameraInstruction(instructionForSequenceIndex(cam.sequenceIndex));
  } else if (turn === expected) {
    setCameraInstruction(instructionForSequenceIndex(cam.sequenceIndex, true));
  } else {
    setCameraInstruction(instructionForSequenceIndex(cam.sequenceIndex));
  }
}

function updateRingProgress() {
  const cam = state.camera;
  const progress = (cam.sequenceIndex + cam.holdFrames / cam.requiredHold) / cam.sequence.length;
  const circumference = 578; // 2 * PI * 92 (approx, matches SVG radius)
  const offset = circumference - circumference * Math.min(1, Math.max(0, progress));
  const ringFill = document.getElementById("ringFill");
  if (ringFill) ringFill.style.strokeDashoffset = String(offset);
}

/* Captures the selfie into an in-memory canvas. No Blob, no object
   URL for storage purposes — the canvas itself is kept in state and
   compressed directly to a Base64 data URL at submit time. */
function captureSelfie() {
  const video = document.getElementById("video");
  const size = Math.min(video.videoWidth || 480, video.videoHeight || 480);
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  const sx = ((video.videoWidth || size) - size) / 2;
  const sy = ((video.videoHeight || size) - size) / 2;
  ctx.drawImage(video, sx, sy, size, size, 0, 0, 480, 480);

  state.selfieCanvas = canvas;

  const img = document.getElementById("selfiePreview");
  img.src = canvas.toDataURL("image/jpeg", 0.9);
  img.hidden = false;

  document.getElementById("video").hidden = true;
  document.getElementById("livenessRing").hidden = true;
  setCameraInstruction("Selfie captured.");
  setCameraStatus("Looks good.");
  document.getElementById("cameraControlsRetake").hidden = false;
  document.getElementById("cameraControlsStart").hidden = true;
  clearError("selfie");

  stopCamera(); // preserves verification flags; only tears down the stream
}

function retakeSelfie() {
  const img = document.getElementById("selfiePreview");
  img.src = "";
  img.hidden = true;
  state.selfieCanvas = null;

  document.getElementById("video").hidden = false;
  document.getElementById("cameraControlsRetake").hidden = true;
  document.getElementById("cameraControlsStart").hidden = true;

  resetCameraState();
  startCamera();
}

function showCameraError(msg) {
  const el = document.getElementById("cameraError");
  el.textContent = msg;
  el.hidden = false;
}
function hideCameraError() {
  const el = document.getElementById("cameraError");
  el.hidden = true;
  el.textContent = "";
}
function setCameraInstruction(text) {
  document.getElementById("cameraInstruction").textContent = text;
}
function setCameraStatus(text) {
  document.getElementById("cameraStatus").textContent = text;
}

/* ===========================================================
   REVIEW (Step 6)
   =========================================================== */
function idTypeLabel(v) {
  return (
    {
      national_id: "National ID",
      passport: "Passport",
      drivers_license: "Driver's License",
      residence_permit: "Residence Permit"
    }[v] || v
  );
}

function maskId(id) {
  if (!id) return "";
  const clean = id.replace(/\s+/g, "");
  if (clean.length <= 4) return "*".repeat(clean.length);
  return "*".repeat(clean.length - 4) + clean.slice(-4);
}

function renderReview() {
  const container = document.getElementById("reviewContent");
  container.innerHTML = "";

  const sections = [
    {
      title: "Personal",
      rows: [
        ["Full name", state.personal.fullName],
        ["Date of birth", state.personal.dateOfBirth],
        ["Gender", state.personal.gender === "male" ? "Male" : state.personal.gender === "female" ? "Female" : "Not selected"],
        ["Nationality", state.personal.nationality],
        ["Country of residence", state.personal.countryOfResidence],
        ["City", state.personal.city]
      ]
    },
    {
      title: "Contact",
      rows: [
        ["Country code", state.contact.dialCode],
        ["WhatsApp", state.contact.whatsappNumber],
        ["Email", state.contact.email || "Not provided"],
        ["Address", state.contact.address]
      ]
    },
    {
      title: "Identity document",
      rows: [
        ["Document type", idTypeLabel(state.identity.idType)],
        ["Document number", maskId(state.identity.idNumber)],
        ["Expiry", state.identity.idExpiry || "Not provided"]
      ]
    },
    {
      title: "Verification",
      rows: [
        ["Front ID uploaded", state.files.front ? "Yes" : "No"],
        ["Back ID uploaded", state.files.back ? "Yes" : "No"],
        ["Live selfie verified", state.selfieCanvas && state.camera.verification.livenessCompleted ? "Yes" : "No"]
      ]
    }
  ];

  sections.forEach((sec) => {
    const h = document.createElement("div");
    h.className = "review__section-title";
    h.textContent = sec.title;
    container.appendChild(h);

    sec.rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "review__row";
      const l = document.createElement("span");
      l.className = "review__label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "review__value";
      v.textContent = value;
      row.appendChild(l);
      row.appendChild(v);
      container.appendChild(row);
    });
  });

  updateSubmitButtonState();
}

/* ===========================================================
   IMAGE COMPRESSION — resize + JPEG-quality reduction, with an
   automatic retry loop that shrinks further if the combined
   payload is still too large for a safe Firestore document.
   =========================================================== */
function fileToImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read one of your uploaded photos. Please try a different file."));
    };
    img.src = url;
  });
}

function getSourceDimensions(source) {
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
}

function drawToCanvas(source, maxDimension) {
  const { width, height } = getSourceDimensions(source);
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function estimateBase64Bytes(dataUrl) {
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.ceil(base64.length * 0.75);
}

/* Iteratively lowers JPEG quality, then dimension, until the
   encoded size is within budget (or the floor is reached). */
function compressImageSource(source, { maxDimension = 1400, targetBytes = TARGET_ID_IMAGE_BYTES } = {}) {
  let dimension = maxDimension;
  let quality = 0.82;
  let dataUrl = "";

  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = drawToCanvas(source, dimension);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    const size = estimateBase64Bytes(dataUrl);

    if (size <= targetBytes || (quality <= MIN_QUALITY && dimension <= MIN_ID_DIMENSION)) {
      return dataUrl;
    }
    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - 0.12);
    } else {
      dimension = Math.max(MIN_SELFIE_DIMENSION, Math.round(dimension * 0.8));
      quality = 0.7;
    }
  }
  return dataUrl;
}

/* Compresses front/back/selfie, then runs a combined safety pass:
   if the three images together are still too large, the single
   largest one is recompressed harder and the check repeats. */
async function buildCompressedImages() {
  const frontImg = await fileToImageElement(state.files.front.file);
  const backImg = state.files.back ? await fileToImageElement(state.files.back.file) : null;
  const selfieSource = state.selfieCanvas;

  let frontDim = 1400;
  let backDim = 1400;
  let selfieDim = 480;

  let front = compressImageSource(frontImg, { maxDimension: frontDim, targetBytes: TARGET_ID_IMAGE_BYTES });
  let back = backImg ? compressImageSource(backImg, { maxDimension: backDim, targetBytes: TARGET_ID_IMAGE_BYTES }) : null;
  let selfie = compressImageSource(selfieSource, { maxDimension: selfieDim, targetBytes: TARGET_SELFIE_IMAGE_BYTES });

  let total = estimateBase64Bytes(front) + (back ? estimateBase64Bytes(back) : 0) + estimateBase64Bytes(selfie);
  let guard = 0;

  while (total > MAX_COMBINED_IMAGE_BYTES && guard < 5) {
    guard++;
    const entries = [
      { key: "front", size: estimateBase64Bytes(front) },
      ...(back ? [{ key: "back", size: estimateBase64Bytes(back) }] : []),
      { key: "selfie", size: estimateBase64Bytes(selfie) }
    ].sort((a, b) => b.size - a.size);

    const target = entries[0].key;
    if (target === "front") {
      frontDim = Math.max(MIN_ID_DIMENSION, Math.round(frontDim * 0.75));
      front = compressImageSource(frontImg, { maxDimension: frontDim, targetBytes: TARGET_ID_IMAGE_BYTES * 0.7 });
    } else if (target === "back") {
      backDim = Math.max(MIN_ID_DIMENSION, Math.round(backDim * 0.75));
      back = compressImageSource(backImg, { maxDimension: backDim, targetBytes: TARGET_ID_IMAGE_BYTES * 0.7 });
    } else {
      selfieDim = Math.max(MIN_SELFIE_DIMENSION, Math.round(selfieDim * 0.8));
      selfie = compressImageSource(selfieSource, { maxDimension: selfieDim, targetBytes: TARGET_SELFIE_IMAGE_BYTES * 0.7 });
    }

    total = estimateBase64Bytes(front) + (back ? estimateBase64Bytes(back) : 0) + estimateBase64Bytes(selfie);
  }

  return { front, back, selfie };
}

/* ===========================================================
   SUBMISSION — this is the ONLY place in the file that ever
   calls setLoading(true, ...).
   =========================================================== */
function generateKycId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
  return `KYC-${hex}`;
}

/* Best-effort uniqueness check. Under the locked-down security rules
   provided with this system, kycSubmissions only allows create (not
   read) for the public form, so this read is expected to fail with
   permission-denied — handled gracefully by falling back to the
   generated id, whose 32 bits of randomness already make collisions
   negligible. */
async function generateUniqueKycId() {
  for (let i = 0; i < 5; i++) {
    const id = generateKycId();
    try {
      const snap = await fnGetDoc(fnDoc(db, "kycSubmissions", id));
      if (!snap.exists()) return id;
    } catch (err) {
      console.error("KYC id uniqueness check unavailable, using generated id:", err);
      return id;
    }
  }
  return generateKycId() + "-" + Date.now().toString(36).toUpperCase();
}

async function handleSubmit() {
  if (state.submitting) return; // prevent duplicate submissions

  if (!validateStep1() || !validateStep2() || !validateStep3() || !validateStep4() || !validateStep5() || !validateStep6()) {
    toast("Please complete all required steps before submitting.", "error");
    return;
  }
  if (!db) {
    toast("We couldn't connect to DahabiPay services. Please check your connection and try again.", "error");
    return;
  }

  state.submitting = true;
  document.getElementById("btnSubmit").disabled = true;

  let succeeded = false;

  try {
    setLoading(true, "Submitting your verification...");

    const kycId = await generateUniqueKycId();

    setLoading(true, "Compressing your documents...");
    const images = await buildCompressedImages();

    setLoading(true, "Saving your verification securely...");

    const fullWhatsAppNumber = `${state.contact.dialCode}${state.contact.whatsappNumber}`;

    const docData = {
      kycId,
      status: "pending",
      reviewStatus: "pending",
      personal: {
        fullName: state.personal.fullName,
        dateOfBirth: state.personal.dateOfBirth,
        gender: state.personal.gender,
        nationality: state.personal.nationality,
        countryOfResidence: state.personal.countryOfResidence,
        city: state.personal.city
      },
      contact: {
        countryCode: state.contact.dialCode,
        whatsappNumber: state.contact.whatsappNumber,
        fullWhatsAppNumber,
        email: state.contact.email,
        address: state.contact.address
      },
      identity: {
        documentType: state.identity.idType,
        documentNumber: state.identity.idNumber,
        expiryDate: state.identity.idExpiry
      },
      verification: {
        frontIdImage: images.front,
        backIdImage: images.back,
        selfieImage: images.selfie,
        faceDetected: state.camera.verification.faceDetected,
        singleFace: state.camera.verification.singleFace,
        livenessCompleted: state.camera.verification.livenessCompleted,
        livenessSequence: ["center", "left", "center", "right", "center"]
      },
      createdAt: fnServerTimestamp(),
      updatedAt: fnServerTimestamp(),
      submittedAt: fnServerTimestamp()
    };

    // Final authoritative size guard right before writing. Our compression
    // budget targets ~820KB of combined images, so this should always pass
    // with generous headroom under Firestore's 1,048,576-byte hard limit —
    // but we check for real rather than assume.
    const approxDocBytes = new Blob([JSON.stringify(docData)]).size;
    if (approxDocBytes > FIRESTORE_SAFE_LIMIT_BYTES) {
      throw new Error("Your documents are too large to submit even after compression. Please retake clearer, smaller photos and try again.");
    }

    await fnSetDoc(fnDoc(db, "kycSubmissions", kycId), docData);

    setLoading(true, "Verification submitted successfully.");
    await sleep(500);

    succeeded = true;
    showSuccess(kycId);
  } catch (err) {
    console.error("KYC submission error:", err);
    toast(err && err.message && err.message.includes("too large") ? err.message : "Your KYC could not be submitted. Please try again.", "error");
  } finally {
    setLoading(false);
    state.submitting = false;
    if (!succeeded) {
      updateSubmitButtonState();
    }
  }
}

function showSuccess(kycId) {
  document.getElementById("kycRefValue").textContent = kycId;
  document.getElementById("wizard").hidden = true;
  document.getElementById("successScreen").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ===========================================================
   CLEANUP ON UNLOAD
   =========================================================== */
window.addEventListener("beforeunload", () => {
  stopCamera();
});

/* ===========================================================
   BOOTSTRAP
   The wizard is visible in the HTML from the moment the page
   renders — nothing here hides it or shows any loading screen.
   Country/nationality/dial-code lists are populated
   synchronously and Firebase initializes quietly in the
   background; neither ever touches the loading overlay.
   =========================================================== */
function main() {
  populateCountrySelect(document.getElementById("nationality"));
  populateCountrySelect(document.getElementById("countryOfResidence"));
  populateDialCodeSelect(document.getElementById("dialCode"));

  setupUploader("front");
  setupUploader("back");
  wireNav();
  wireCamera();
  wireDeclarations();
  goToStep(1);

  setLoading(false); // belt-and-suspenders: overlay starts hidden regardless

  initFirebase().then((ok) => {
    if (!ok) {
      toast("We're having trouble connecting. You can keep filling out the form; please check your connection before submitting.", "error");
    }
  });
}

main();
