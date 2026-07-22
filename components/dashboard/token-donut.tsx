'use client';

import React, { useState } from 'react';

interface DonutSegment {
  name: string;
  tokens: number;
  color: string;
  percentage: number;
}

interface TokenDonutProps {
  segments: DonutSegment[];
  totalTokens: number;
}

export function TokenDonut({ segments, totalTokens }: TokenDonutProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // SVG parameters
  const size = 200;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Calculate cumulative percentages for offsets
  let accumulatedPercentage = 0;

  return (
    <div className="flex flex-col items-center justify-center p-4">
      {/* SVG Ring Donut Chart */}
      <div className="relative w-[200px] h-[200px]">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90 overflow-visible"
        >
          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="rgba(255, 255, 255, 0.03)"
            strokeWidth={strokeWidth}
          />

          {/* Render segments */}
          {segments.map((seg, idx) => {
            const strokeDashoffset = circumference - (seg.percentage / 100) * circumference;
            const strokeDasharray = `${circumference} ${circumference}`;
            const rotationOffset = (accumulatedPercentage / 100) * 360;
            
            // Advance accumulator
            accumulatedPercentage += seg.percentage;

            const isHovered = hoveredIdx === idx;

            return (
              <circle
                key={seg.name}
                cx={center}
                cy={center}
                r={radius}
                fill="transparent"
                stroke={seg.color}
                strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                transform={`rotate(${rotationOffset} ${center} ${center})`}
                strokeLinecap="round"
                className="transition-all duration-300 cursor-pointer"
                style={{
                  filter: isHovered 
                    ? `drop-shadow(0 0 8px ${seg.color}) opacity(1)` 
                    : 'opacity(0.85)',
                }}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            );
          })}
        </svg>

          {/* Central Label inside the donut */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              {hoveredIdx !== null ? segments[hoveredIdx].name : 'Tokens Totales'}
            </span>
            <span className="text-2xl font-black text-white mt-0.5 tracking-tight">
              {hoveredIdx !== null 
                ? segments[hoveredIdx].tokens.toLocaleString('es-MX') 
                : totalTokens.toLocaleString('es-MX')}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5 font-medium">
              {hoveredIdx !== null 
                ? `${segments[hoveredIdx].percentage.toFixed(1)}%` 
                : '100.0%'}
            </span>
          </div>
      </div>

      {/* Legend list below */}
      <div className="w-full mt-6 space-y-2">
        {segments.map((seg, idx) => {
          const isHovered = hoveredIdx === idx;
          return (
            <div
              key={seg.name}
              className={`flex items-center justify-between p-2 rounded-xl transition-colors cursor-pointer ${
                isHovered ? 'bg-white/5' : 'hover:bg-white/2'
              }`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="w-2.5 h-2.5 rounded-full transition-all" 
                  style={{ 
                    backgroundColor: seg.color,
                    boxShadow: isHovered ? `0 0 6px ${seg.color}` : 'none'
                  }} 
                />
                <span className={`text-xs transition-colors ${isHovered ? 'text-white font-medium' : 'text-slate-400'}`}>
                  {seg.name}
                </span>
              </div>
              <span className="text-xs font-semibold text-slate-300">
                {seg.percentage.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
