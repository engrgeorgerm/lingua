import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text, TouchableOpacity,
  View
} from 'react-native';

// ── LANGUAGES ────────────────────────────────────────────────────
const LANGS: Record<string, { name: string; flag: string; speech: string }> = {
  es:    { name: 'Español',   flag: '🇪🇸', speech: 'es-ES' },
  en:    { name: 'English',   flag: '🇺🇸', speech: 'en-US' },
  fr:    { name: 'Français',  flag: '🇫🇷', speech: 'fr-FR' },
  pt:    { name: 'Português', flag: '🇧🇷', speech: 'pt-BR' },
  de:    { name: 'Deutsch',   flag: '🇩🇪', speech: 'de-DE' },
  it:    { name: 'Italiano',  flag: '🇮🇹', speech: 'it-IT' },
  ar:    { name: 'العربية',   flag: '🇸🇦', speech: 'ar-SA' },
  ru:    { name: 'Русский',   flag: '🇷🇺', speech: 'ru-RU' },
  hi:    { name: 'हिन्दी',   flag: '🇮🇳', speech: 'hi-IN' },
  ko:    { name: '한국어',    flag: '🇰🇷', speech: 'ko-KR' },
  zh:    { name: '中文',      flag: '🇨🇳', speech: 'zh-CN' },
  ja:    { name: '日本語',    flag: '🇯🇵', speech: 'ja-JP' },
};
const LANG_LIST = Object.keys(LANGS);

// ── SCRIPT DETECTION ─────────────────────────────────────────────
function detectByScript(text: string): string | null {
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';
  if (/[\u0900-\u097f]/.test(text)) return 'hi';
  return null;
}

async function detectLang(text: string): Promise<string | null> {
  const byScript = detectByScript(text);
  if (byScript) return byScript;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text.substring(0, 80))}`;
    const res = await fetch(url);
    const data = await res.json();
    let det: string = data[2] || '';
    if (det === 'zh-cn' || det === 'zh') det = 'zh';
    return LANGS[det] ? det : null;
  } catch {
    return null;
  }
}

async function translateText(text: string, from: string, to: string): Promise<string> {
  const fromCode = from === 'zh' ? 'zh-CN' : from;
  const toCode = to === 'zh' ? 'zh-CN' : to;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromCode}|${toCode}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(data.responseMessage);
  return data.responseData.translatedText;
}

// ── TYPES ────────────────────────────────────────────────────────
type Phase = 'idle' | 'listening' | 'detecting' | 'confirm' | 'translating' | 'speaking';
type HistoryItem = { id: string; original: string; translated: string; from: string; to: string; time: string };

// ── MAIN COMPONENT ───────────────────────────────────────────────
export default function LinguaScreen() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [translation, setTranslation] = useState('');
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState('en');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [confirmFrom, setConfirmFrom] = useState('es');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalRef = useRef('');
  const progressRef = useRef<Animated.CompositeAnimation | null>(null);

  // ── SPEECH RECOGNITION EVENTS ────────────────────────────────
  useSpeechRecognitionEvent('result', (event) => {
    const isFinal = event.isFinal ?? false;
    const text = event.results?.[0]?.transcript ?? '';
    if (isFinal && text) {
      finalRef.current += (finalRef.current ? ' ' : '') + text.trim();
    }
    const interim = !isFinal ? text : '';
    setTranscript((finalRef.current + (interim ? ' ' + interim : '')).trim());
  });

  useSpeechRecognitionEvent('end', () => {
    // Recognition ended — process what we have
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (event.error !== 'aborted') {
      Alert.alert('Error de micrófono', event.message || event.error);
    }
    stopListening();
  });

  // ── PULSE ANIMATION ──────────────────────────────────────────
  useEffect(() => {
    if (phase === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [phase]);

  // ── PROGRESS BAR ─────────────────────────────────────────────
  function startProgress() {
    progressAnim.setValue(0);
    progressRef.current = Animated.timing(progressAnim, {
      toValue: 1, duration: 18000, useNativeDriver: false,
    });
    progressRef.current.start();
    warnTimer.current = setTimeout(() => {
      // Visual warning at 13s
      setPhase('listening'); // triggers re-render with warning color
    }, 13000);
  }

  function stopProgress() {
    progressRef.current?.stop();
    progressAnim.setValue(0);
    if (warnTimer.current) { clearTimeout(warnTimer.current); warnTimer.current = null; }
  }

  // ── RECORDING ────────────────────────────────────────────────
  async function startListening() {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso denegado', 'LINGUA necesita acceso al micrófono para funcionar.');
      return;
    }
    finalRef.current = '';
    setTranscript('');
    setTranslation('');
    setDetectedLang(null);

    ExpoSpeechRecognitionModule.start({
      lang: 'es-ES', // hint — Whisper in native will be language-agnostic
      interimResults: true,
      continuous: true,
    });
    setPhase('listening');
    startProgress();
  }

  function stopListening() {
    ExpoSpeechRecognitionModule.stop();
    stopProgress();
    const full = finalRef.current.trim();
    if (!full) { setPhase('idle'); return; }
    processText(full);
  }

  function handlePTT() {
    if (phase === 'idle') startListening();
    else if (phase === 'listening') stopListening();
  }

  // ── DETECT + CONFIRM ─────────────────────────────────────────
  async function processText(text: string) {
    setPhase('detecting');
    const detected = await detectLang(text);
    const fromCode = detected || 'es';
    setDetectedLang(fromCode);
    setConfirmText(text);
    setConfirmFrom(fromCode);
    setPhase('confirm');
  }

  async function confirmTranslation(toCode: string) {
    setTargetLang(toCode);
    setPhase('translating');
    try {
      const result = await translateText(confirmText, confirmFrom, toCode);
      setTranslation(result);
      addHistory(confirmText, result, confirmFrom, toCode);
      setPhase('speaking');
      const speechLang = LANGS[toCode]?.speech || 'en-US';
      Speech.speak(result, {
        language: speechLang,
        rate: 0.9,
        onDone: () => setPhase('idle'),
        onError: () => setPhase('idle'),
      });
    } catch {
      Alert.alert('Error', 'No se pudo traducir. Verifica tu conexión.');
      setPhase('idle');
    }
  }

  function addHistory(orig: string, trl: string, from: string, to: string) {
    const item: HistoryItem = {
      id: Date.now().toString(),
      original: orig,
      translated: trl,
      from, to,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setHistory(prev => [item, ...prev].slice(0, 30));
  }

  function replayTranslation() {
    if (!translation) return;
    Speech.speak(translation, { language: LANGS[targetLang]?.speech || 'en-US', rate: 0.9 });
  }

  // ── CONFIRM OPTIONS ──────────────────────────────────────────
  const confirmOptions = LANG_LIST
    .filter(c => c !== confirmFrom)
    .sort((a, b) => (a === targetLang ? -1 : b === targetLang ? 1 : 0))
    .slice(0, 4);

  // ── PROGRESS COLOR ───────────────────────────────────────────
  const progressColor = progressAnim.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: ['#C9A84C', '#d46020', '#cc3010'],
  });

  // ── BUTTON STATE ─────────────────────────────────────────────
  const isListening = phase === 'listening';
  const isBusy = phase === 'translating' || phase === 'detecting';
  const btnLabel = isListening ? '⏹ PARAR' : isBusy ? '···' : phase === 'speaking' ? '♪' : '🎙 HABLAR';
  const statusMsg: Record<Phase, string> = {
    idle:        'Toca el botón para hablar',
    listening:   'Escuchando... toca para parar',
    detecting:   'Detectando idioma...',
    confirm:     '¿A qué idioma traducir?',
    translating: 'Traduciendo...',
    speaking:    'Reproduciendo traducción...',
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0e0c" />

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* HEADER */}
        <View style={s.header}>
          <View>
            <Text style={s.logo}>LINGUA</Text>
            <Text style={s.logoSub}>TRADUCTOR UNIVERSAL</Text>
          </View>
          <TouchableOpacity style={s.histBtn} onPress={() => setShowHistory(true)}>
            <Text style={s.histBtnText}>📋 {history.length > 0 ? history.length : ''}</Text>
          </TouchableOpacity>
        </View>

        {/* TARGET LANG BAR */}
        <View style={s.targetBar}>
          <Text style={s.targetLabel}>Traducir a</Text>
          <TouchableOpacity style={s.targetPicker} onPress={() => setShowLangPicker(true)}>
            <Text style={s.targetFlag}>{LANGS[targetLang]?.flag}</Text>
            <Text style={s.targetName}>{LANGS[targetLang]?.name}</Text>
            <Text style={s.targetArrow}>▾</Text>
          </TouchableOpacity>
        </View>

        {/* PTT BUTTON */}
        <View style={s.pttWrap}>
          {isListening && (
            <>
              <Animated.View style={[s.ring, s.ring1, { transform: [{ scale: pulseAnim }] }]} />
              <Animated.View style={[s.ring, s.ring2, { transform: [{ scale: pulseAnim }] }]} />
            </>
          )}
          <TouchableOpacity
            style={[
              s.pttBtn,
              isListening && s.pttListening,
              isBusy && s.pttBusy,
              phase === 'speaking' && s.pttSpeaking,
            ]}
            onPress={handlePTT}
            disabled={isBusy || phase === 'confirm'}
            activeOpacity={0.85}
          >
            {/* Wave bars */}
            <View style={s.waveBars}>
              {[0,1,2,3,4,5,6].map(i => (
                <Animated.View
                  key={i}
                  style={[
                    s.bar,
                    isListening && s.barActive,
                  ]}
                />
              ))}
            </View>
            <Text style={[s.pttLbl, isListening && s.pttLblLit]}>{btnLabel}</Text>
          </TouchableOpacity>
        </View>

        {/* PROGRESS BAR */}
        {isListening && (
          <View style={s.progressWrap}>
            <Animated.View style={[s.progressBar, { width: progressAnim.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] }), backgroundColor: progressColor }]} />
          </View>
        )}

        {/* STATUS */}
        <Text style={[s.statusText, isListening && s.statusLit]}>{statusMsg[phase]}</Text>

        {/* TIP */}
        {phase === 'idle' && (
          <View style={s.tip}>
            <Text style={s.tipText}>💡 Habla en frases cortas. LINGUA detecta tu idioma automáticamente.</Text>
          </View>
        )}

        {/* TRANSCRIPT */}
        {transcript.length > 0 && (
          <View style={s.bubble}>
            <Text style={s.bubbleLabel}>🎙 Lo que dijiste</Text>
            <Text style={s.bubbleText}>{transcript}</Text>
          </View>
        )}

        {/* CONFIRM PANEL */}
        {phase === 'confirm' && detectedLang && (
          <View style={s.confirmPanel}>
            <View style={s.confirmDetected}>
              <Text style={s.confirmFlag}>{LANGS[confirmFrom]?.flag}</Text>
              <View>
                <Text style={s.confirmLabel}>IDIOMA DETECTADO</Text>
                <Text style={s.confirmLang}>{LANGS[confirmFrom]?.name}</Text>
              </View>
            </View>
            <Text style={s.confirmPreview}>"{confirmText.substring(0, 80)}{confirmText.length > 80 ? '...' : ''}"</Text>
            <Text style={s.confirmQuestion}>¿TRADUCIR A...?</Text>
            <View style={s.confirmOptions}>
              {confirmOptions.map(code => (
                <TouchableOpacity
                  key={code}
                  style={[s.confirmOpt, code === targetLang && s.confirmOptPreferred]}
                  onPress={() => confirmTranslation(code)}
                >
                  <Text style={s.optFlag}>{LANGS[code]?.flag}</Text>
                  <Text style={s.optName}>{LANGS[code]?.name}</Text>
                  {code === targetLang && <Text style={s.optStar}>★</Text>}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* TRANSLATION */}
        {translation.length > 0 && phase !== 'confirm' && (
          <View style={[s.bubble, s.bubbleTrl]}>
            <View style={s.bubbleHeader}>
              <Text style={s.bubbleLabel}>{LANGS[targetLang]?.flag} {LANGS[targetLang]?.name}</Text>
              <TouchableOpacity style={s.replayBtn} onPress={replayTranslation}>
                <Text style={s.replayBtnText}>▶ Repetir</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.bubbleText}>{translation}</Text>
          </View>
        )}

      </ScrollView>

      {/* LANG PICKER MODAL */}
      <Modal visible={showLangPicker} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Seleccionar idioma destino</Text>
            <FlatList
              data={LANG_LIST}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.modalItem, item === targetLang && s.modalItemActive]}
                  onPress={() => { setTargetLang(item); setShowLangPicker(false); }}
                >
                  <Text style={s.modalItemFlag}>{LANGS[item].flag}</Text>
                  <Text style={s.modalItemName}>{LANGS[item].name}</Text>
                  {item === targetLang && <Text style={s.modalCheck}>✓</Text>}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={s.modalClose} onPress={() => setShowLangPicker(false)}>
              <Text style={s.modalCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* HISTORY MODAL */}
      <Modal visible={showHistory} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Historial — {history.length} traducciones</Text>
            {history.length === 0 ? (
              <Text style={s.emptyHist}>Aún sin conversaciones</Text>
            ) : (
              <FlatList
                data={history}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <View style={s.histItem}>
                    <View style={s.histMeta}>
                      <Text style={s.histTime}>{item.time}</Text>
                      <Text style={s.histPair}>{LANGS[item.from]?.flag} → {LANGS[item.to]?.flag}</Text>
                    </View>
                    <Text style={s.histOrig}>{item.original}</Text>
                    <Text style={s.histTrl}>{item.translated}</Text>
                  </View>
                )}
              />
            )}
            <View style={s.histActions}>
              {history.length > 0 && (
                <TouchableOpacity onPress={() => setHistory([])}>
                  <Text style={s.histClear}>Borrar todo</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.modalClose} onPress={() => setShowHistory(false)}>
                <Text style={s.modalCloseText}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ── STYLES ───────────────────────────────────────────────────────
const G = '#C9A84C';
const GD = 'rgba(201,168,76,0.14)';
const GB = 'rgba(201,168,76,0.28)';

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: '#0f0e0c' },
  scroll:       { alignItems: 'center', paddingBottom: 40 },

  header:       { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, paddingTop: 20, marginBottom: 16 },
  logo:         { fontFamily: 'serif', fontSize: 28, fontWeight: '300', letterSpacing: 6, color: G },
  logoSub:      { fontSize: 8, letterSpacing: 3, color: '#2a2824', marginTop: 2 },
  histBtn:      { backgroundColor: GD, borderWidth: 1, borderColor: GB, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  histBtnText:  { color: G, fontSize: 13 },

  targetBar:    { width: '90%', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 28, gap: 10 },
  targetLabel:  { fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#5a5248' },
  targetPicker: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  targetFlag:   { fontSize: 22 },
  targetName:   { fontSize: 14, fontWeight: '500', color: '#E0D8C8', flex: 1 },
  targetArrow:  { fontSize: 11, color: '#4a4640' },

  pttWrap:      { width: 170, height: 170, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  ring:         { position: 'absolute', width: 170, height: 170, borderRadius: 85 },
  ring1:        { borderWidth: 2, borderColor: G },
  ring2:        { borderWidth: 1, borderColor: GB },
  pttBtn:       { width: 144, height: 144, borderRadius: 72, backgroundColor: '#131110', borderWidth: 2, borderColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center', gap: 8, elevation: 8 },
  pttListening: { backgroundColor: '#7a5215', borderColor: 'rgba(201,168,76,0.65)' },
  pttBusy:      { backgroundColor: '#202030', borderColor: 'rgba(255,255,255,0.09)' },
  pttSpeaking:  { backgroundColor: '#152215', borderColor: 'rgba(255,255,255,0.09)' },

  waveBars:     { flexDirection: 'row', alignItems: 'center', gap: 3, height: 32 },
  bar:          { width: 4, height: 5, borderRadius: 99, backgroundColor: 'rgba(201,168,76,0.2)' },
  barActive:    { backgroundColor: G, height: 20 },

  pttLbl:       { fontSize: 11, letterSpacing: 2, fontWeight: '700', color: '#5a5248', textTransform: 'uppercase' },
  pttLblLit:    { color: '#fff5d8' },

  progressWrap: { width: '90%', height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', marginBottom: 8 },
  progressBar:  { height: '100%', borderRadius: 99 },

  statusText:   { fontSize: 13, letterSpacing: 0.5, color: '#4a4640', marginBottom: 12, textAlign: 'center' },
  statusLit:    { color: '#9a8a5a' },

  tip:          { width: '90%', backgroundColor: 'rgba(201,168,76,0.05)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.15)', borderRadius: 14, padding: 12, marginBottom: 12 },
  tipText:      { fontSize: 12, color: '#8a7a4a', lineHeight: 18 },

  bubble:       { width: '90%', backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 15, marginBottom: 12 },
  bubbleTrl:    { backgroundColor: 'rgba(201,168,76,0.05)', borderColor: GB },
  bubbleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  bubbleLabel:  { fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#3a3830', marginBottom: 7 },
  bubbleText:   { fontSize: 15, lineHeight: 24, color: '#E0D8C8', fontWeight: '300' },
  replayBtn:    { backgroundColor: GD, borderWidth: 1, borderColor: GB, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 5 },
  replayBtnText:{ color: G, fontSize: 11 },

  confirmPanel: { width: '90%', backgroundColor: 'rgba(20,20,28,0.98)', borderWidth: 1, borderColor: GB, borderRadius: 20, padding: 20, marginBottom: 12, gap: 12 },
  confirmDetected:{ flexDirection: 'row', alignItems: 'center', gap: 12 },
  confirmFlag:  { fontSize: 32 },
  confirmLabel: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#5a5248' },
  confirmLang:  { fontSize: 18, fontWeight: '500', color: '#E8E0D0' },
  confirmPreview:{ fontSize: 13, color: '#6a6258', fontStyle: 'italic', borderLeftWidth: 2, borderLeftColor: GB, paddingLeft: 10, lineHeight: 20 },
  confirmQuestion:{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#5a5248' },
  confirmOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirmOpt:   { flex: 1, minWidth: '45%', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderRadius: 14, padding: 12 },
  confirmOptPreferred: { backgroundColor: GD, borderColor: GB },
  optFlag:      { fontSize: 20 },
  optName:      { fontSize: 13, fontWeight: '500', color: '#D8D0C0', flex: 1 },
  optStar:      { fontSize: 11, color: G },

  modalBg:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: '#1a1815', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '75%', paddingTop: 20 },
  modalTitle:   { fontSize: 14, fontWeight: '600', color: '#E8E0D0', letterSpacing: 0.5, paddingHorizontal: 20, marginBottom: 12 },
  modalItem:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  modalItemActive:{ backgroundColor: GD },
  modalItemFlag:{ fontSize: 22 },
  modalItemName:{ fontSize: 15, color: '#E0D8C8', flex: 1 },
  modalCheck:   { fontSize: 16, color: G },
  modalClose:   { margin: 16, backgroundColor: GD, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: GB },
  modalCloseText:{ color: G, fontSize: 14, fontWeight: '600' },

  emptyHist:    { textAlign: 'center', color: '#3a3830', fontSize: 14, padding: 40 },
  histItem:     { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  histMeta:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  histTime:     { fontSize: 10, color: '#3a3830' },
  histPair:     { fontSize: 10, color: '#7a6030' },
  histOrig:     { fontSize: 12, color: '#5a5248', marginBottom: 3, lineHeight: 18 },
  histTrl:      { fontSize: 14, color: '#D0C8B8', lineHeight: 20 },
  histActions:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  histClear:    { color: '#5a5248', fontSize: 12, padding: 16 },
});
