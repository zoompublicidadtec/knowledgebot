'use client';

import { Chats } from '@phosphor-icons/react';

interface ActivityChartProps {
  data?: { date: string; count: number }[];
}

export function ActivityChart({ data = [] }: ActivityChartProps) {
  // Mock data if none provided
  const chartData = data.length > 0 ? data : [
    { date: '1', count: 5 },
    { date: '2', count: 8 },
    { date: '3', count: 12 },
    { date: '4', count: 6 },
    { date: '5', count: 15 },
    { date: '6', count: 9 },
    { date: '7', count: 14 },
    { date: '8', count: 20 },
    { date: '9', count: 11 },
    { date: '10', count: 18 },
  ];

  const maxVal = Math.max(...chartData.map(d => d.count), 1);
  const height = 120;
  const width = 500;
  const padding = 10;

  // Calculate points
  const points = chartData.map((d, index) => {
    const x = padding + (index * (width - padding * 2)) / (chartData.length - 1);
    const y = height - padding - (d.count * (height - padding * 2)) / maxVal;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Chats size={18} className="text-primary-400" />
          Conversaciones Diarias
        </h3>
        <span className="text-[10px] text-slate-500">Últimos 10 días</span>
      </div>

      <div className="relative w-full h-[140px] pt-4">
        {/* SVG Sparkline chart */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full overflow-visible"
        >
          {/* Gradient */}
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Area */}
          {chartData.length > 1 && (
            <polygon
              points={`${padding},${height - padding} ${points} ${width - padding},${height - padding}`}
              fill="url(#chartGrad)"
            />
          )}

          {/* Line */}
          {chartData.length > 1 && (
            <polyline
              fill="none"
              stroke="#6366f1"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points}
            />
          )}

          {/* Dot circles */}
          {chartData.map((d, index) => {
            const x = padding + (index * (width - padding * 2)) / (chartData.length - 1);
            const y = height - padding - (d.count * (height - padding * 2)) / maxVal;
            return (
              <circle
                key={index}
                cx={x}
                cy={y}
                r="4"
                fill="#818cf8"
                stroke="#0f172a"
                strokeWidth="1.5"
                className="transition-all hover:r-6 cursor-pointer"
              >
                <title>{`${d.count} conversaciones`}</title>
              </circle>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
