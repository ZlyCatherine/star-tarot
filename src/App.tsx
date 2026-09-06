import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight, ChevronLeft, Eye, Hand, Heart, MoonStar, RefreshCw, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { tarotCards, tarotSpreads, type TarotCard, type TarotSpread } from './tarot-data';

type Stage = 'select' | 'focus' | 'shuffle' | 'draw';
type PreparedCard = { card: TarotCard; reversed: boolean; wheelSlot: number };
type DrawnCard = PreparedCard & { revealed: boolean };
type GestureSample = [x: number, y: number, time: number, pressure: number, dx: number, dy: number];
type GesturePass = GestureSample[];
type Point = { x: number; y: number };
type ShuffleVisual = { x: number; y: number; angle: number; energy: number; active: boolean };
type PendingShuffleFrame = { progress: number; visual: ShuffleVisual };

const WHEEL_STEP = 360 / tarotCards.length;
const MAX_GESTURE_PASSES = 10;

const iconBySpread: Record<TarotSpread['id'], typeof MoonStar> = {
  daily: MoonStar,
  development: Sparkles,
  advice: Eye,
  'love-cross': Heart,
};

function randomUnit() {
  const value = new Uint32Array(1);
  window.crypto.getRandomValues(value);
  return value[0] / 4294967296;
}

function normalizeAngle(value: number) {
  if (value > Math.PI) return value - Math.PI * 2;
  if (value < -Math.PI) return value + Math.PI * 2;
  return value;
}

function normalizeDegrees(value: number) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function wheelDepth(angle: number) {
  return Math.round((normalizeDegrees(angle) + 180) * 100) + 1;
}

function prepareDeck(random: () => number): PreparedCard[] {
  const cards = [...tarotCards];
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
  return cards.map((card, wheelSlot) => ({ card, reversed: random() < 0.5, wheelSlot }));
}

async function randomFromGesture(passes: GesturePass[], salt: Uint32Array) {
  const serializedPasses = passes.map((samples, passIndex) => (
    `${passIndex}:${samples.map((sample) => sample.join(',')).join(';')}`
  )).join('|');
  const serialized = `${Array.from(salt).join('.')};${serializedPasses}`;
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  const seed = new Uint32Array(digest);
  let a = seed[0];
  let b = seed[1];
  let c = seed[2];
  let d = seed[3];
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const value = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11));
    c = (c + value) | 0;
    return (value >>> 0) / 4294967296;
  };
}

function CardBack() {
  return (
    <span className="card-back" aria-hidden="true">
      <span className="back-orbit"><MoonStar /></span>
      <span className="back-star star-one">✦</span>
      <span className="back-star star-two">·</span>
      <span className="back-star star-three">✧</span>
    </span>
  );
}

function App() {
  const [stage, setStage] = useState<Stage>('select');
  const [spread, setSpread] = useState<TarotSpread | null>(null);
  const [question, setQuestion] = useState('');
  const [deck, setDeck] = useState<PreparedCard[]>([]);
  const [drawn, setDrawn] = useState<DrawnCard[]>([]);
  const [shuffleProgress, setShuffleProgress] = useState(0);
  const [shufflePassCount, setShufflePassCount] = useState(0);
  const [finalizingShuffle, setFinalizingShuffle] = useState(false);
  const [departingCardId, setDepartingCardId] = useState<string | null>(null);
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [wheelDragging, setWheelDragging] = useState(false);
  const [shuffleVisual, setShuffleVisual] = useState<ShuffleVisual>({ x: 0, y: 0, angle: 0, energy: 0, active: false });

  const shuffleSurfaceRef = useRef<HTMLDivElement>(null);
  const pointerActiveRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const lastAngleRef = useRef<number | null>(null);
  const gesturePassesRef = useRef<GesturePass[]>([]);
  const activeGestureSamplesRef = useRef<GestureSample[]>([]);
  const gestureDistanceRef = useRef(0);
  const gestureAngleRef = useRef(0);
  const gestureSaltRef = useRef(new Uint32Array(4));
  const shuffleRectRef = useRef<DOMRect | null>(null);
  const shuffleFrameRef = useRef(0);
  const pendingShuffleFrameRef = useRef<PendingShuffleFrame | null>(null);
  const wheelSurfaceRef = useRef<HTMLDivElement>(null);
  const wheelPointerActiveRef = useRef(false);
  const wheelRotationRef = useRef(0);
  const wheelCenterRef = useRef<Point | null>(null);
  const wheelFrameRef = useRef(0);
  const wheelLayerKeyRef = useRef(Number.NaN);
  const forceWheelLayerSyncRef = useRef(false);
  const wheelLastAngleRef = useRef(0);
  const wheelAccumulatedDragRef = useRef(0);
  const wheelLastTimeRef = useRef(0);
  const wheelVelocityRef = useRef(0);
  const wheelMovedRef = useRef(false);
  const suppressCardClickUntilRef = useRef(0);
  const shuffleOperationRef = useRef(0);
  const departureTimerRef = useRef<number | null>(null);

  const allDrawn = Boolean(spread && drawn.length === spread.positions.length);
  const allRevealed = allDrawn && drawn.every((item) => item.revealed);

  const progressText = useMemo(() => {
    if (!spread) return '';
    if (!allDrawn) return `已抽取 ${drawn.length} / ${spread.positions.length} 张`;
    const revealed = drawn.filter((item) => item.revealed).length;
    if (!allRevealed) return `已翻开 ${revealed} / ${spread.positions.length} 张`;
    return '牌阵已完整揭示';
  }, [allDrawn, allRevealed, drawn, spread]);

  useEffect(() => () => {
    shuffleOperationRef.current += 1;
    if (departureTimerRef.current !== null) window.clearTimeout(departureTimerRef.current);
    if (shuffleFrameRef.current) window.cancelAnimationFrame(shuffleFrameRef.current);
    if (wheelFrameRef.current) window.cancelAnimationFrame(wheelFrameRef.current);
  }, []);

  function cancelPendingWork() {
    shuffleOperationRef.current += 1;
    if (departureTimerRef.current !== null) {
      window.clearTimeout(departureTimerRef.current);
      departureTimerRef.current = null;
    }
  }

  function clearGesture() {
    if (shuffleFrameRef.current) window.cancelAnimationFrame(shuffleFrameRef.current);
    shuffleFrameRef.current = 0;
    pendingShuffleFrameRef.current = null;
    gesturePassesRef.current = [];
    activeGestureSamplesRef.current = [];
    gestureDistanceRef.current = 0;
    gestureAngleRef.current = 0;
    lastPointRef.current = null;
    lastAngleRef.current = null;
    pointerActiveRef.current = false;
    shuffleRectRef.current = null;
    window.crypto.getRandomValues(gestureSaltRef.current);
    setShuffleProgress(0);
    setShufflePassCount(0);
    setShuffleVisual({ x: 0, y: 0, angle: 0, energy: 0, active: false });
  }

  function scrollPageTop() {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  function resetWheel() {
    if (wheelFrameRef.current) window.cancelAnimationFrame(wheelFrameRef.current);
    wheelFrameRef.current = 0;
    wheelPointerActiveRef.current = false;
    wheelCenterRef.current = null;
    wheelRotationRef.current = 0;
    wheelLayerKeyRef.current = Number.NaN;
    forceWheelLayerSyncRef.current = false;
  }

  function chooseSpread(selected: TarotSpread) {
    cancelPendingWork();
    setSpread(selected);
    setQuestion('');
    setDeck([]);
    setDrawn([]);
    setFinalizingShuffle(false);
    setDepartingCardId(null);
    setPendingCardId(null);
    resetWheel();
    clearGesture();
    setStage('focus');
    scrollPageTop();
  }

  function startShuffle() {
    if (!spread) return;
    cancelPendingWork();
    setFinalizingShuffle(false);
    clearGesture();
    setStage('shuffle');
    scrollPageTop();
  }

  function beginGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (finalizingShuffle) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    shuffleRectRef.current = rect;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointerActiveRef.current = true;
    gestureDistanceRef.current = 0;
    gestureAngleRef.current = 0;
    setShuffleProgress(0);
    lastPointRef.current = point;
    lastAngleRef.current = Math.atan2(point.y - rect.height / 2, point.x - rect.width / 2);
    activeGestureSamplesRef.current = [[Math.round(point.x * 10), Math.round(point.y * 10), Math.round(event.timeStamp), Math.round(event.pressure * 1000), 0, 0]];
    setShuffleVisual((current) => ({ ...current, x: point.x / rect.width - 0.5, y: point.y / rect.height - 0.5, active: true }));
  }

  function moveGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointerActiveRef.current || finalizingShuffle) return;
    const rect = shuffleRectRef.current;
    if (!rect) return;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const lastPoint = lastPointRef.current;
    if (!lastPoint) return;
    const dx = point.x - lastPoint.x;
    const dy = point.y - lastPoint.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1.5) return;

    gestureDistanceRef.current += distance;
    const angle = Math.atan2(point.y - rect.height / 2, point.x - rect.width / 2);
    if (lastAngleRef.current !== null) gestureAngleRef.current += Math.abs(normalizeAngle(angle - lastAngleRef.current));
    lastAngleRef.current = angle;
    lastPointRef.current = point;

    if (activeGestureSamplesRef.current.length < 720) {
      activeGestureSamplesRef.current.push([
        Math.round(point.x * 10), Math.round(point.y * 10), Math.round(event.timeStamp),
        Math.round(event.pressure * 1000), Math.round(dx * 10), Math.round(dy * 10),
      ]);
    }

    const distanceProgress = gestureDistanceRef.current / 420;
    const angleProgress = gestureAngleRef.current / (Math.PI * 1.25);
    const progress = Math.min(100, Math.floor(Math.min(distanceProgress, angleProgress) * 100));
    pendingShuffleFrameRef.current = {
      progress,
      visual: {
        x: point.x / rect.width - 0.5,
        y: point.y / rect.height - 0.5,
        angle,
        energy: Math.min(1, distance / 22 + progress / 160),
        active: true,
      },
    };
    if (!shuffleFrameRef.current) {
      shuffleFrameRef.current = window.requestAnimationFrame(() => {
        shuffleFrameRef.current = 0;
        const pending = pendingShuffleFrameRef.current;
        if (!pending) return;
        pendingShuffleFrameRef.current = null;
        setShuffleProgress(pending.progress);
        setShuffleVisual(pending.visual);
      });
    }
  }

  function endGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (shuffleFrameRef.current) window.cancelAnimationFrame(shuffleFrameRef.current);
    shuffleFrameRef.current = 0;
    pendingShuffleFrameRef.current = null;
    if (activeGestureSamplesRef.current.length >= 3 && gestureDistanceRef.current >= 36) {
      const completedPass = [...activeGestureSamplesRef.current];
      gesturePassesRef.current = [...gesturePassesRef.current, completedPass].slice(-MAX_GESTURE_PASSES);
      setShufflePassCount(gesturePassesRef.current.length);
    }
    activeGestureSamplesRef.current = [];
    pointerActiveRef.current = false;
    shuffleRectRef.current = null;
    lastPointRef.current = null;
    lastAngleRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setShuffleVisual((current) => ({ ...current, active: false, energy: current.energy * 0.45 }));
    setShuffleProgress(0);
  }

  async function finishShuffle(withGesture: boolean) {
    if (finalizingShuffle || (withGesture && gesturePassesRef.current.length === 0)) return;
    const operationId = shuffleOperationRef.current + 1;
    shuffleOperationRef.current = operationId;
    setFinalizingShuffle(true);
    try {
      let random = randomUnit;
      if (withGesture) {
        const passes = gesturePassesRef.current.map((pass) => [...pass]);
        const salt = new Uint32Array(gestureSaltRef.current);
        try {
          random = await randomFromGesture(passes, salt);
        } catch {
          random = randomUnit;
        }
      }
      if (operationId !== shuffleOperationRef.current) return;
      setDeck(prepareDeck(random));
      setDrawn([]);
      setPendingCardId(null);
      resetWheel();
      setStage('draw');
      scrollPageTop();
    } finally {
      if (operationId === shuffleOperationRef.current) setFinalizingShuffle(false);
    }
  }

  function selectFanCard(index: number) {
    if (!spread || departingCardId || drawn.length >= spread.positions.length) return;
    if (performance.now() < suppressCardClickUntilRef.current) return;
    const selected = deck[index];
    if (!selected) return;
    setPendingCardId(selected.card.id);
  }

  function confirmCardSelection() {
    if (!spread || !pendingCardId || departingCardId || drawn.length >= spread.positions.length) return;
    const selected = deck.find((item) => item.card.id === pendingCardId);
    if (!selected) {
      setPendingCardId(null);
      return;
    }
    setPendingCardId(null);
    setDepartingCardId(selected.card.id);
    if (departureTimerRef.current !== null) window.clearTimeout(departureTimerRef.current);
    departureTimerRef.current = window.setTimeout(() => {
      departureTimerRef.current = null;
      setDeck((current) => current.filter((item) => item.card.id !== selected.card.id));
      setDrawn((current) => [...current, { ...selected, revealed: false }]);
      setDepartingCardId(null);
    }, 460);
  }

  function beginWheelDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (pendingCardId || departingCardId) return;
    const disc = event.currentTarget.querySelector<HTMLElement>('.card-wheel-disc');
    const discRect = disc?.getBoundingClientRect();
    const centerX = discRect ? discRect.left + discRect.width / 2 : event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth / 2;
    const centerY = discRect ? discRect.top + discRect.height / 2 : event.currentTarget.getBoundingClientRect().bottom;
    wheelCenterRef.current = { x: centerX, y: centerY };
    wheelPointerActiveRef.current = true;
    wheelLastAngleRef.current = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
    wheelAccumulatedDragRef.current = 0;
    wheelLastTimeRef.current = event.timeStamp;
    wheelVelocityRef.current = 0;
    wheelMovedRef.current = false;
    setWheelDragging(false);
  }

  function syncWheelLayers(rotation: number, force = false) {
    const layerKey = Math.round(rotation / WHEEL_STEP);
    if (!force && layerKey === wheelLayerKeyRef.current) return;
    wheelLayerKeyRef.current = layerKey;
    wheelSurfaceRef.current?.querySelectorAll<HTMLElement>('.fan-card-space').forEach((element) => {
      const slot = Number(element.dataset.wheelSlot);
      if (!Number.isFinite(slot)) return;
      element.style.zIndex = String(wheelDepth(normalizeDegrees(slot * WHEEL_STEP + rotation)));
    });
  }

  function scheduleWheelPaint(forceLayers = false) {
    forceWheelLayerSyncRef.current ||= forceLayers;
    if (wheelFrameRef.current) return;
    wheelFrameRef.current = window.requestAnimationFrame(() => {
      wheelFrameRef.current = 0;
      const force = forceWheelLayerSyncRef.current;
      forceWheelLayerSyncRef.current = false;
      wheelSurfaceRef.current?.style.setProperty('--wheel-rotation', `${wheelRotationRef.current}deg`);
      syncWheelLayers(wheelRotationRef.current, force);
    });
  }

  function moveWheelDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!wheelPointerActiveRef.current || pendingCardId || departingCardId) return;
    const center = wheelCenterRef.current;
    if (!center) return;
    const pointerAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180 / Math.PI;
    const angleDelta = normalizeDegrees(pointerAngle - wheelLastAngleRef.current);
    const elapsed = Math.max(8, event.timeStamp - wheelLastTimeRef.current);
    wheelLastAngleRef.current = pointerAngle;
    wheelLastTimeRef.current = event.timeStamp;
    wheelAccumulatedDragRef.current += Math.abs(angleDelta);
    if (wheelAccumulatedDragRef.current <= 1.2) return;
    if (!wheelMovedRef.current) {
      wheelMovedRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setWheelDragging(true);
    }
    wheelVelocityRef.current = angleDelta / elapsed;
    wheelRotationRef.current += angleDelta;
    scheduleWheelPaint();
  }

  function endWheelDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!wheelPointerActiveRef.current) return;
    wheelPointerActiveRef.current = false;
    wheelCenterRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setWheelDragging(false);
    if (wheelMovedRef.current) {
      suppressCardClickUntilRef.current = performance.now() + 220;
      const momentum = Math.max(-28, Math.min(28, wheelVelocityRef.current * 90));
      window.requestAnimationFrame(() => {
        wheelRotationRef.current += momentum;
        scheduleWheelPaint(true);
      });
    }
  }

  function revealCard(index: number) {
    if (!allDrawn) return;
    setDrawn((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, revealed: true } : item
    )));
  }

  function resetReading() {
    cancelPendingWork();
    setStage('select');
    setSpread(null);
    setQuestion('');
    setDeck([]);
    setDrawn([]);
    setFinalizingShuffle(false);
    setDepartingCardId(null);
    setPendingCardId(null);
    resetWheel();
    clearGesture();
    scrollPageTop();
  }

  function shuffleCardStyle(index: number): CSSProperties {
    const offset = index - 10.5;
    const phase = shuffleVisual.angle + index * 0.73;
    const spreadAmount = 8 + shuffleVisual.energy * 86;
    const x = Math.cos(phase) * spreadAmount + shuffleVisual.x * (28 + (index % 4) * 6);
    const y = Math.sin(phase) * spreadAmount * 0.62 + shuffleVisual.y * (24 + (index % 3) * 7);
    const rotation = offset * 0.7 + Math.sin(phase) * shuffleVisual.energy * 28;
    return { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${rotation}deg)` };
  }

  function wheelCardStyle(item: PreparedCard, fallbackIndex: number): CSSProperties {
    const slot = item.wheelSlot ?? fallbackIndex;
    const angle = slot * WHEEL_STEP;
    return {
      '--wheel-angle': `${angle}deg`,
      zIndex: wheelDepth(normalizeDegrees(angle + wheelRotationRef.current)),
    } as CSSProperties;
  }

  return (
    <main className="app-shell">
      <div className="celestial-field" aria-hidden="true" />
      <header className="topbar">
        <button className="brand" type="button" onClick={resetReading} aria-label="返回首页">
          <span className="brand-mark"><MoonStar /></span><span className="brand-name">星见塔罗</span>
        </button>
        {stage !== 'select' && <Button variant="ghost" className="quiet-button" onClick={resetReading}><ChevronLeft />重新选择牌阵</Button>}
        {stage === 'select' && <span className="deck-caption">RIDER · WAITE · SMITH</span>}
      </header>

      {stage === 'select' && (
        <section className="select-view">
          <div className="hero-copy">
            <p className="kicker"><Sparkles />选择此刻需要的牌阵</p>
            <h1>让牌面映照<span>你已经知道的答案</span></h1>
            <p className="hero-description">安静片刻，想好你希望探索的主题。选择牌阵后，静心洗牌，再从完整牌环中抽出你选中的牌。</p>
          </div>
          <div className="spread-grid">
            {tarotSpreads.map((item, index) => {
              const Icon = iconBySpread[item.id];
              return (
                <article className="spread-choice" key={item.id}>
                  <div className="choice-heading"><span className="choice-icon"><Icon /></span><span className="choice-number">0{index + 1}</span></div>
                  <div className="choice-content"><p>{item.eyebrow}</p><h2>{item.name}</h2><span>{item.description}</span></div>
                  <Button className="gold-button" onClick={() => chooseSpread(item)}>选择牌阵<ArrowRight /></Button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {stage === 'focus' && spread && (
        <section className="focus-view">
          <div className="step-label">准备 · {spread.eyebrow}</div><h1>{spread.name}</h1><p className="section-intro">{spread.description}</p>
          <div className="focus-panel">
            <div className="position-guide">
              <p className="panel-label">牌位</p>
              <div className="position-list">{spread.positions.map((position, index) => (
                <div className="position-row" key={position.id}><span>{index + 1}</span><div><strong>{position.label}</strong><small>{position.helper}</small></div></div>
              ))}</div>
            </div>
            <div className="question-box">
              <label htmlFor="question">此刻你想探索什么？</label><p>问题可以留在心里，也可以写下来。内容只保留在当前页面。</p>
              <Textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：这段关系目前最需要我看见什么？" maxLength={160} className="question-input" />
              <span className="character-count">{question.length} / 160</span>
            </div>
          </div>
          <div className="focus-actions">
            <Button variant="ghost" className="quiet-button" onClick={resetReading}><ChevronLeft />返回</Button>
            <Button className="gold-button shuffle-button" onClick={startShuffle}><Hand />进入洗牌</Button>
          </div>
        </section>
      )}

      {stage === 'shuffle' && spread && (
        <section className="shuffle-view">
          <div className="shuffle-heading">
            <p className="step-label">洗牌</p>
            <h1>在牌堆上画圈</h1>
            <p>跟随感觉移动，洗到你觉得可以为止。</p>
          </div>
          <div
            ref={shuffleSurfaceRef}
            className={`shuffle-surface ${shuffleVisual.active ? 'is-touching' : ''} ${shufflePassCount > 0 ? 'has-passes' : ''}`}
            onPointerDown={beginGesture}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            role="region"
            aria-label="在牌堆上画圈洗牌"
          >
            <div className="gesture-ring" style={{ '--gesture-progress': `${shuffleProgress * 3.6}deg` } as CSSProperties}>
              <span />
            </div>
            <div className="shuffle-deck" aria-hidden="true">
              {Array.from({ length: 22 }, (_, index) => (
                <span className="shuffle-card" style={shuffleCardStyle(index)} key={index}><CardBack /></span>
              ))}
            </div>
            <span
              className={`gesture-cursor ${shuffleVisual.active ? 'is-visible' : ''}`}
              style={{ left: `${(shuffleVisual.x + 0.5) * 100}%`, top: `${(shuffleVisual.y + 0.5) * 100}%` }}
              aria-hidden="true"
            />
            <div className="gesture-instruction"><Hand /><strong>{shuffleVisual.active ? '继续画圈' : shufflePassCount > 0 ? '可以继续洗牌' : '按住并画圈'}</strong><span>{shuffleVisual.active ? '顺着你的感觉移动' : shufflePassCount > 0 ? '洗好后就开始抽牌' : '在牌堆上慢慢画圈'}</span></div>
          </div>
          <div className="shuffle-actions">
            <button type="button" className="text-action" onClick={() => finishShuffle(false)} disabled={finalizingShuffle}>帮我洗牌</button>
            <Button className="gold-button finish-shuffle" onClick={() => finishShuffle(true)} disabled={shufflePassCount === 0 || finalizingShuffle}>
              {finalizingShuffle ? <RefreshCw className="spinning" /> : <Sparkles />}{finalizingShuffle ? '正在整理牌堆…' : '完成洗牌，开始抽牌'}
            </Button>
          </div>
        </section>
      )}

      {stage === 'draw' && spread && (
        <section className="draw-view">
          <div className="reading-heading">
            <div>
              <p className="step-label">{spread.name} · {spread.eyebrow}</p>
              <h1>{!allDrawn ? `为「${spread.positions[drawn.length]?.label}」选牌` : allRevealed ? '你的牌阵' : '翻开你选定的牌'}</h1>
              <p>{!allDrawn ? `用手指拖动牌环，从剩余 ${deck.length} 张牌中找到你想选定的那张。` : allRevealed ? '慢慢阅读每个位置带来的线索。' : '这些牌已经由你亲自选定。牌面朝你时为正位，旋转 180° 时为逆位。'}</p>
            </div>
            <span className="progress-pill" aria-live="polite">{progressText}</span>
          </div>
          {question.trim() && <blockquote className="question-echo">“{question.trim()}”</blockquote>}

          <div className="reading-workspace cards-complete">
            <div className={`spread-board board-${spread.id}`}>
              {spread.positions.map((position, index) => {
                const item = drawn[index];
                return (
                  <div className="card-slot" style={{ gridArea: position.area }} key={position.id}>
                    <button className={`tarot-card ${item ? 'has-card' : 'is-empty'} ${item?.revealed ? 'is-revealed' : ''}`} type="button" onClick={() => revealCard(index)} disabled={!item || !allDrawn || item.revealed} aria-label={item ? `${position.label}：${item.revealed ? `${item.card.nameZh}${item.reversed ? '逆位' : '正位'}` : '点击翻牌'}` : `${position.label}，等待抽牌`}>
                      <span className="tarot-card-inner">
                        {item ? <CardBack /> : <span className="empty-card"><span>{index + 1}</span></span>}
                        <span className={`card-face ${item?.reversed ? 'is-reversed' : ''}`}>{item && <img src={`${import.meta.env.BASE_URL}cards/${item.card.image}`} alt={item.card.nameZh} />}</span>
                      </span>
                    </button>
                    <div className="slot-caption"><strong>{index + 1} · {position.label}</strong><span>{item?.revealed ? `${item.card.nameZh} · ${item.reversed ? '逆位' : '正位'}` : position.helper}</span></div>
                  </div>
                );
              })}
            </div>
          </div>

          {!allDrawn && (
            <section className="fan-picker" aria-label="选择要抽取的牌">
              <div className="fan-meta"><span><Hand />拖动牌环转动整副牌</span><span>{deck.length} 张可选</span></div>
              <div
                ref={wheelSurfaceRef}
                className={`card-wheel ${wheelDragging ? 'is-dragging' : ''}`}
                onPointerDown={beginWheelDrag}
                onPointerMove={moveWheelDrag}
                onPointerUp={endWheelDrag}
                onPointerCancel={endWheelDrag}
                role="region"
                aria-label="按住牌环并沿圆弧拖动"
              >
                <div className="card-wheel-rotor">
                  <div className="card-wheel-disc" aria-hidden="true"><span /></div>
                  {deck.map((item, index) => (
                    <div className="fan-card-space" data-wheel-slot={item.wheelSlot ?? index} style={wheelCardStyle(item, index)} key={item.card.id}>
                      <button className={`fan-card-button ${departingCardId === item.card.id ? 'is-departing' : ''}`} type="button" onClick={() => selectFanCard(index)} disabled={Boolean(departingCardId)} aria-label={`选定牌环中的第 ${index + 1} 张牌`}><CardBack /></button>
                    </div>
                  ))}
                </div>
              </div>
              <p className="fan-hint">拖动牌环浏览整副牌，轻点你选定的那张。</p>
            </section>
          )}

          {allDrawn && !allRevealed && <p className="reveal-hint"><Sparkles />{drawn.length === 1 ? '点击这张已选好的牌，将它翻开' : '依次点击你选好的牌，将它们翻开'}</p>}

          {allRevealed && (
            <section className="interpretations" aria-labelledby="interpretation-title">
              <div className="interpretation-heading"><div><p className="step-label">牌面解读</p><h2 id="interpretation-title">留意彼此呼应的线索</h2></div><Button variant="outline" className="outline-button" onClick={() => chooseSpread(spread)}><RefreshCw />重新抽取</Button></div>
              <div className="interpretation-list">{drawn.map((item, index) => {
                const position = spread.positions[index];
                const meaning = item.reversed ? item.card.reversed : item.card.upright;
                return (
                  <article className="meaning-card" key={`${position.id}-${item.card.id}`}>
                    <div className={`meaning-image ${item.reversed ? 'is-reversed' : ''}`}><img src={`${import.meta.env.BASE_URL}cards/${item.card.image}`} alt="" /></div>
                    <div className="meaning-copy"><p>{index + 1} · {position.label}<span>{item.reversed ? '逆位' : '正位'}</span></p><h3>{item.card.nameZh}<small>{item.card.nameEn}</small></h3><div className="keyword-row">{item.card.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div><p className="meaning-text"><strong>{position.helper}：</strong>{meaning}</p></div>
                  </article>
                );
              })}</div>
            </section>
          )}

          <Dialog open={Boolean(pendingCardId && !allDrawn)} onOpenChange={(open) => {
            if (!open && !departingCardId) setPendingCardId(null);
          }}>
            {pendingCardId && !allDrawn && (
              <DialogContent className="confirm-dialog" showCloseButton={false}>
                <div className="confirm-card-preview"><CardBack /></div>
                <p className="step-label">{drawn.length + 1} · {spread.positions[drawn.length]?.label}</p>
                <DialogTitle id="confirm-card-title">确定选择这张牌吗？</DialogTitle>
                <DialogDescription>确认后，这张牌会离开牌环并进入「{spread.positions[drawn.length]?.label}」牌位。</DialogDescription>
                <div className="confirm-actions">
                  <DialogClose render={<Button variant="ghost" className="quiet-button" />}><ChevronLeft />再看看</DialogClose>
                  <Button className="gold-button" onClick={confirmCardSelection}><Sparkles />确定选择</Button>
                </div>
              </DialogContent>
            )}
          </Dialog>
        </section>
      )}

      <footer className="footer"><span>牌面仅供娱乐与自我探索参考</span><span>牌图源自公共领域 RWS 历史扫描 · <a href="https://commons.wikimedia.org/wiki/Category:Rider-Waite_tarot_deck" target="_blank" rel="noreferrer">查看来源</a></span></footer>
    </main>
  );
}

export default App;
