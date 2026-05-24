import { useEffect, useRef } from "react";

const PPM = 60;

interface DemoWheelProps {
  width?: number;
  height?: number;
}

export function DemoWheel({ width = 400, height = 140 }: DemoWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const colors = ["#D94F3A", "#6FA9C8", "#7CA05C", "#E8B64C", "#A87BA8"];

    function mulberry32(seed: number) {
      let s = seed | 0;
      return function () {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function buildWobblePath(
      vertices: Array<{ x: number; y: number }>,
      seed: number,
      offsetX: number,
      offsetY: number
    ): Path2D {
      const path = new Path2D();
      if (vertices.length < 3) return path;

      const rng = mulberry32(seed);
      const n = vertices.length;

      path.moveTo(offsetX + vertices[0].x * PPM, offsetY + vertices[0].y * PPM);

      for (let i = 0; i < n; i++) {
        const curr = vertices[i];
        const next = vertices[(i + 1) % n];

        const cx = offsetX + curr.x * PPM;
        const cy = offsetY + curr.y * PPM;
        const nx = offsetX + next.x * PPM;
        const ny = offsetY + next.y * PPM;

        const ex = nx - cx;
        const ey = ny - cy;
        const len = Math.hypot(ex, ey);
        if (len < 0.01) continue;

        const nnx = -ey / len;
        const nny = ex / len;

        for (let m = 1; m <= 2; m++) {
          const t = m / 3;
          const mx = cx + ex * t;
          const my = cy + ey * t;
          const offset = (rng() - 0.5) * 1.4;
          const mx2 = mx + nnx * offset;
          const my2 = my + nny * offset;
          const cpx = mx2 + (rng() - 0.5) * 0.6;
          const cpy = my2 + (rng() - 0.5) * 0.6;
          path.quadraticCurveTo(cpx, cpy, mx2, my2);
        }

        path.lineTo(nx, ny);
      }

      path.closePath();
      return path;
    }

    function createWheelShape(sides: number, radius: number): Array<{ x: number; y: number }> {
      const vertices: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
        vertices.push({
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        });
      }
      return vertices;
    }

    // Create a simple undulating terrain path
    const terrainY = height - 25;
    const terrainAmplitude = 8;
    const terrainFrequency = 0.02;

    function getTerrainY(x: number): number {
      return terrainY + Math.sin(x * terrainFrequency) * terrainAmplitude;
    }

    const wheelConfigs = [
      { sides: 3, radius: 0.4, name: "triangle", speed: 1.2 },
      { sides: 4, radius: 0.35, name: "square", speed: 1.0 },
      { sides: 5, radius: 0.38, name: "pentagon", speed: 0.85 },
      { sides: 6, radius: 0.35, name: "hexagon", speed: 0.75 },
      { sides: 8, radius: 0.32, name: "octagon", speed: 0.65 },
    ];

    // Wheel radius in pixels (approximate for different shapes)
    const wheelRadiusPx = 22;

    const wheels = wheelConfigs.map((config, i) => ({
      ...config,
      vertices: createWheelShape(config.sides, config.radius),
      x: -50 - i * 120, // Start off-screen to the left
      y: 0,
      color: colors[i % colors.length],
      rotation: 0,
    }));

    let startTime: number | null = null;

    function animate(timestamp: number) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const dt = 16.67; // Approximate 60fps delta in ms

      ctx.clearRect(0, 0, width, height);

      // Draw terrain
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 5) {
        ctx.lineTo(x, getTerrainY(x));
      }
      ctx.lineTo(width, height);
      ctx.closePath();

      // Terrain fill (tan)
      ctx.fillStyle = "#E5D3B0";
      ctx.fill();

      // Terrain cross-hatch pattern (simplified)
      ctx.strokeStyle = "rgba(43, 33, 24, 0.1)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 8) {
        const y = getTerrainY(x);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 6, y + 10);
        ctx.stroke();
      }

      // Terrain top edge (ink)
      ctx.beginPath();
      for (let x = 0; x <= width; x += 3) {
        const y = getTerrainY(x);
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = "#2B2118";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      // Animate and draw wheels
      for (const wheel of wheels) {
        // Move wheel horizontally
        wheel.x += wheel.speed * (dt / 16);

        // Wrap around when off-screen
        if (wheel.x > width + 50) {
          wheel.x = -50;
        }

        // Calculate rotation based on distance traveled (rolling motion)
        const wheelRadiusMeters = wheel.radius;
        wheel.rotation = wheel.x / (wheelRadiusMeters * PPM);

        // Position wheel on terrain
        wheel.y = getTerrainY(wheel.x) - wheelRadiusPx + 5;

        // Wobble seed changes slowly for subtle animation
        const seed = wheel.sides * 1000 + Math.floor(elapsed / 3000);

        ctx.save();
        ctx.translate(wheel.x, wheel.y);
        ctx.rotate(wheel.rotation);

        const path = buildWobblePath(
          wheel.vertices.map((v) => ({ x: v.x, y: v.y })),
          seed,
          0,
          0
        );

        ctx.fillStyle = wheel.color;
        ctx.fill(path);

        ctx.strokeStyle = "#2B2118";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke(path);

        ctx.restore();
      }

      animationRef.current = requestAnimationFrame(animate);
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: "block",
        margin: "0 auto 24px auto",
      }}
      aria-hidden="true"
    />
  );
}
