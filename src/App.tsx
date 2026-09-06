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
type ShuffleVisual = { x: number; y: number; active: boolean };
type ShuffleCardPose = { x: number; y: number; rotation: number; vx: number; vy: number; vRotation: number; z: number };
type PendingShuffleFrame = { visual: ShuffleVisual };

const WHEEL_STEP = 360 / tarotCards.length;
const MAX_GESTURE_PASSES = 10;
const SHUFFLE_CARD_COUNT = 22;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function visualNoise(value: number) {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function createShuffleCardPoses(): ShuffleCardPose[] {
  return Array.from({ length: SHUFFLE_CARD_COUNT }, (_, index) => {
    const offset = index - (SHUFFLE_CARD_COUNT - 1) / 2;
    return {
      x: offset * 0.42,
      y: offset * 0.08,
      rotation: offset * 0.34,
      vx: 0,
      vy: 0,
      vRotation: 0,
      z: index + 1,
    };
  });
}

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
  const [shufflePassCount, setShufflePassCount] = useState(0);
  const [finalizingShuffle, setFinalizingShuffle] = useState(false);
  const [departingCardId, setDepartingCardId] = useState<string | null>(null);
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [wheelDragging, setWheelDragging] = useState(false);
  const [shuffleVisual, setShuffleVisual] = useState<ShuffleVisual>({ x: 0, y: 0, active: false });

  const shuffleSurfaceRef = useRef<HTMLDivElement>(null);
  const pointerActiveRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const gesturePassesRef = useRef<GesturePass[]>([]);
  const activeGestureSamplesRef = useRef<GestureSample[]>([]);
  const gestureDistanceRef = useRef(0);
  const gestureSaltRef = useRef(new Uint32Array(4));
  const shuffleRectRef = useRef<DOMRect | null>(null);
  const shuffleFrameRef = useRef(0);
  const shufflePhysicsFrameRef = useRef(0);
  const shufflePhysicsTimeRef = useRef(0);
  const pendingShuffleFrameRef = useRef<PendingShuffleFrame | null>(null);
  const shuffleCardPosesRef = useRef<ShuffleCardPose[]>(createShuffleCardPoses());
  const wheelSurfaceRef = useRef<HTMLDivElement>(null);
  const wheelPointerActiveRef = useRef(false);
  const wheelRotationRef = useRef(0);
  const wheelCenterRef = useRef<Point | null>(null);
  const wheelFrameRef = useRef(0);
  const wheelInertiaFrameRef = useRef(0);
  const wheelLayerKeyRef = useRef(Number.NaN);
  const forceWheelLayerSyncRef = useRef(false);
  const wheelLastAngleRef = useRef(0);
  const wheelLastPointerRef = useRef<Point | null>(null);
  const wheelDragDistanceRef = useRef(0);
  const wheelPendingAngleRef = useRef(0);
  const wheelDragGainRef = useRef(1.4);
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
    if (shufflePhysicsFrameRef.current) window.cancelAnimationFrame(shufflePhysicsFrameRef.current);
    if (wheelFrameRef.current) window.cancelAnimationFrame(wheelFrameRef.current);
    if (wheelInertiaFrameRef.current) window.cancelAnimationFrame(wheelInertiaFrameRef.current);
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
    if (shufflePhysicsFrameRef.current) window.cancelAnimationFrame(shufflePhysicsFrameRef.current);
    shuffleFrameRef.current = 0;
    shufflePhysicsFrameRef.current = 0;
    shufflePhysicsTimeRef.current = 0;
    pendingShuffleFrameRef.current = null;
    gesturePassesRef.current = [];
    activeGestureSamplesRef.current = [];
    gestureDistanceRef.current = 0;
    lastPointRef.current = null;
    pointerActiveRef.current = false;
    shuffleRectRef.current = null;
    shuffleCardPosesRef.current = createShuffleCardPoses();
    window.crypto.getRandomValues(gestureSaltRef.current);
    setShufflePassCount(0);
    setShuffleVisual({ x: 0, y: 0, active: false });
  }

  function scrollPageTop() {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  function paintShuffleCards() {
    shuffleSurfaceRef.current?.querySelectorAll<HTMLElement>('.shuffle-card').forEach((element) => {
      const index = Number(element.dataset.shuffleIndex);
      const pose = shuffleCardPosesRef.current[index];
      if (!pose) return;
      element.style.transform = `translate(calc(-50% + ${pose.x}px), calc(-50% + ${pose.y}px)) rotate(${pose.rotation}deg)`;
      element.style.zIndex = String(pose.z);
    });
  }

  function syncShuffleLayers() {
    const poses = shuffleCardPosesRef.current;
    poses
      .map((pose, index) => ({ pose, index, depth: pose.y + pose.x * 0.045 }))
      .sort((left, right) => left.depth - right.depth || left.index - right.index)
      .forEach(({ pose }, layer) => {
        pose.z = layer + 1;
      });
  }

  function applyShuffleForces(dx: number, dy: number, point: Point, rect: DOMRect) {
    const distance = Math.max(1, Math.hypot(dx, dy));
    const pointerX = point.x - rect.width / 2;
    const pointerY = point.y - rect.height * 0.48;
    const directionX = dx / distance;
    const directionY = dy / distance;
    const phase = gestureDistanceRef.current / 34;
    const poses = shuffleCardPosesRef.current;
    const impulses = poses.map((pose, index) => {
      const offsetX = pointerX - pose.x;
      const offsetY = pointerY - pose.y;
      const proximity = clamp(1 - Math.hypot(offsetX, offsetY) / 250, 0.06, 1);
      const wave = 0.18 + ((Math.sin(phase + index * 1.73) + 1) / 2) * 0.82;
      const individuality = 0.78 + visualNoise(index * 313 + 41) * 0.44;
      const influence = proximity * wave * individuality;
      const sideBias = visualNoise(index * 557 + 89) - 0.5;
      return {
        x: dx * (0.08 + influence * 0.32) + offsetX * influence * 0.004 - directionY * sideBias * distance * influence * 0.2,
        y: dy * (0.08 + influence * 0.32) + offsetY * influence * 0.004 + directionX * sideBias * distance * influence * 0.2,
        rotation: ((dx - dy) * 0.025 + sideBias * distance * 0.08) * influence,
      };
    });
    const average = impulses.reduce((total, impulse) => ({
      x: total.x + impulse.x / impulses.length,
      y: total.y + impulse.y / impulses.length,
      rotation: total.rotation + impulse.rotation / impulses.length,
    }), { x: 0, y: 0, rotation: 0 });

    poses.forEach((pose, index) => {
      const impulse = impulses[index];
      pose.vx += impulse.x - average.x * 0.92;
      pose.vy += impulse.y - average.y * 0.92;
      pose.vRotation += impulse.rotation - average.rotation * 0.75;
      pose.vx = clamp(pose.vx, -11, 11);
      pose.vy = clamp(pose.vy, -9, 9);
      pose.vRotation = clamp(pose.vRotation, -3.2, 3.2);
    });
  }

  function startShufflePhysics() {
    if (shufflePhysicsFrameRef.current) return;
    shufflePhysicsTimeRef.current = performance.now();
    const animate = (time: number) => {
      const frameScale = clamp((time - shufflePhysicsTimeRef.current) / 16.67, 0.45, 2);
      shufflePhysicsTimeRef.current = time;
      const friction = Math.pow(pointerActiveRef.current ? 0.9 : 0.87, frameScale);
      let moving = pointerActiveRef.current;

      shuffleCardPosesRef.current.forEach((pose) => {
        pose.x += pose.vx * frameScale;
        pose.y += pose.vy * frameScale;
        pose.rotation += pose.vRotation * frameScale;

        if (pose.x < -124 || pose.x > 124) {
          pose.x = clamp(pose.x, -124, 124);
          pose.vx *= -0.28;
        }
        if (pose.y < -88 || pose.y > 88) {
          pose.y = clamp(pose.y, -88, 88);
          pose.vy *= -0.28;
        }
        if (pose.rotation < -66 || pose.rotation > 66) {
          pose.rotation = clamp(pose.rotation, -66, 66);
          pose.vRotation *= -0.22;
        }

        pose.vx *= friction;
        pose.vy *= friction;
        pose.vRotation *= friction;
        if (Math.abs(pose.vx) + Math.abs(pose.vy) + Math.abs(pose.vRotation) > 0.035) moving = true;
      });

      syncShuffleLayers();
      paintShuffleCards();
      if (moving) {
        shufflePhysicsFrameRef.current = window.requestAnimationFrame(animate);
        return;
      }
      shuffleCardPosesRef.current.forEach((pose) => {
        pose.vx = 0;
        pose.vy = 0;
        pose.vRotation = 0;
      });
      shufflePhysicsFrameRef.current = 0;
      shufflePhysicsTimeRef.current = 0;
    };
    shufflePhysicsFrameRef.current = window.requestAnimationFrame(animate);
  }

  function stopWheelInertia() {
    if (wheelInertiaFrameRef.current) window.cancelAnimationFrame(wheelInertiaFrameRef.current);
    wheelInertiaFrameRef.current = 0;
  }

  function resetWheel() {
    stopWheelInertia();
    if (wheelFrameRef.current) window.cancelAnimationFrame(wheelFrameRef.current);
    wheelFrameRef.current = 0;
    wheelPointerActiveRef.current = false;
    wheelCenterRef.current = null;
    wheelLastPointerRef.current = null;
    wheelPendingAngleRef.current = 0;
    wheelRotationRef.current = 0;
    wheelLayerKeyRef.current = Number.NaN;
    forceWheelLayerSyncRef.current = false;
    setWheelDragging(false);
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
    lastPointRef.current = point;
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
    lastPointRef.current = point;

    if (activeGestureSamplesRef.current.length < 720) {
      activeGestureSamplesRef.current.push([
        Math.round(point.x * 10), Math.round(point.y * 10), Math.round(event.timeStamp),
        Math.round(event.pressure * 1000), Math.round(dx * 10), Math.round(dy * 10),
      ]);
    }

    applyShuffleForces(dx, dy, point, rect);
    startShufflePhysics();

    pendingShuffleFrameRef.current = {
      visual: {
        x: point.x / rect.width - 0.5,
        y: point.y / rect.height - 0.5,
        active: true,
      },
    };
    if (!shuffleFrameRef.current) {
      shuffleFrameRef.current = window.requestAnimationFrame(() => {
        shuffleFrameRef.current = 0;
        const pending = pendingShuffleFrameRef.current;
        if (!pending) return;
        pendingShuffleFrameRef.current = null;
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    paintShuffleCards();
    setShuffleVisual((current) => ({ ...current, active: false }));
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
      if (shufflePhysicsFrameRef.current) window.cancelAnimationFrame(shufflePhysicsFrameRef.current);
      shufflePhysicsFrameRef.current = 0;
      resetWheel();
      setStage('draw');
      scrollPageTop();
    } finally {
      if (operationId === shuffleOperationRef.current) setFinalizingShuffle(false);
    }
  }

  function selectFanCard(index: number) {
    if (!spread || departingCardId || drawn.length >= spread.positions.length) return;
    if (wheelPointerActiveRef.current || wheelInertiaFrameRef.current) return;
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
    const wasMoving = Boolean(wheelInertiaFrameRef.current);
    stopWheelInertia();
    if (wasMoving) suppressCardClickUntilRef.current = performance.now() + 120;
    const disc = event.currentTarget.querySelector<HTMLElement>('.card-wheel-disc');
    const discRect = disc?.getBoundingClientRect();
    const centerX = discRect ? discRect.left + discRect.width / 2 : event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth / 2;
    const centerY = discRect ? discRect.top + discRect.height / 2 : event.currentTarget.getBoundingClientRect().bottom;
    wheelCenterRef.current = { x: centerX, y: centerY };
    wheelPointerActiveRef.current = true;
    wheelLastPointerRef.current = { x: event.clientX, y: event.clientY };
    wheelLastAngleRef.current = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
    wheelDragDistanceRef.current = 0;
    wheelPendingAngleRef.current = 0;
    wheelDragGainRef.current = event.pointerType === 'touch' ? 1.65 : 1.4;
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
      const angle = normalizeDegrees(slot * WHEEL_STEP + rotation);
      if (force || Math.abs(angle) <= 82) element.style.zIndex = String(wheelDepth(angle));
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
    const lastPointer = wheelLastPointerRef.current;
    const elapsed = Math.max(8, event.timeStamp - wheelLastTimeRef.current);
    if (lastPointer) wheelDragDistanceRef.current += Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
    wheelLastPointerRef.current = { x: event.clientX, y: event.clientY };
    wheelLastAngleRef.current = pointerAngle;
    wheelLastTimeRef.current = event.timeStamp;
    const boostedDelta = angleDelta * wheelDragGainRef.current;
    wheelPendingAngleRef.current += boostedDelta;
    const instantVelocity = boostedDelta / elapsed;
    wheelVelocityRef.current = wheelVelocityRef.current * 0.72 + instantVelocity * 0.28;
    if (wheelDragDistanceRef.current <= 6) return;
    if (!wheelMovedRef.current) {
      wheelMovedRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setWheelDragging(true);
    }
    wheelRotationRef.current += wheelPendingAngleRef.current;
    wheelPendingAngleRef.current = 0;
    scheduleWheelPaint();
  }

  function startWheelInertia(initialVelocity: number) {
    stopWheelInertia();
    let velocity = clamp(initialVelocity, -0.55, 0.55);
    let lastTime = performance.now();
    const step = (time: number) => {
      const elapsed = Math.min(32, Math.max(8, time - lastTime));
      lastTime = time;
      wheelRotationRef.current += velocity * elapsed;
      velocity *= Math.pow(0.86, elapsed / 16.67);
      scheduleWheelPaint();
      if (Math.abs(velocity) > 0.008) {
        wheelInertiaFrameRef.current = window.requestAnimationFrame(step);
        return;
      }
      wheelInertiaFrameRef.current = 0;
      suppressCardClickUntilRef.current = performance.now() + 100;
      setWheelDragging(false);
      scheduleWheelPaint(true);
    };
    wheelInertiaFrameRef.current = window.requestAnimationFrame(step);
  }

  function endWheelDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!wheelPointerActiveRef.current) return;
    wheelPointerActiveRef.current = false;
    wheelCenterRef.current = null;
    wheelLastPointerRef.current = null;
    wheelPendingAngleRef.current = 0;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (wheelMovedRef.current) {
      suppressCardClickUntilRef.current = performance.now() + 220;
      if (Math.abs(wheelVelocityRef.current) > 0.012) {
        setWheelDragging(true);
        startWheelInertia(wheelVelocityRef.current);
      } else {
        setWheelDragging(false);
        scheduleWheelPaint(true);
      }
    } else {
      setWheelDragging(false);
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
    const pose = shuffleCardPosesRef.current[index];
    return {
      transform: `translate(calc(-50% + ${pose.x}px), calc(-50% + ${pose.y}px)) rotate(${pose.rotation}deg)`,
      zIndex: pose.z,
    };
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
            <div className="shuffle-deck" aria-hidden="true">
              {Array.from({ length: SHUFFLE_CARD_COUNT }, (_, index) => (
                <span className="shuffle-card" data-shuffle-index={index} style={shuffleCardStyle(index)} key={index}><CardBack /></span>
              ))}
            </div>
            <span
              className={`gesture-cursor ${shuffleVisual.active ? 'is-visible' : ''}`}
              style={{ left: `${(shuffleVisual.x + 0.5) * 100}%`, top: `${(shuffleVisual.y + 0.5) * 100}%` }}
              aria-hidden="true"
            />
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
              <div className="interpretation-heading"><h2 id="interpretation-title">牌面解读</h2><Button variant="outline" className="outline-button" onClick={() => chooseSpread(spread)}><RefreshCw />重新抽取</Button></div>
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
