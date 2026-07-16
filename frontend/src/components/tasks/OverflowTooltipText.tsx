'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { isTextOverflowing } from './task-grid-state'

type OverflowTooltipTextProps = {
  text: string
  children?: ReactNode
  className?: string
}

export function OverflowTooltipText({
  text,
  children,
  className,
}: OverflowTooltipTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  const measure = useCallback(() => {
    if (ref.current) setOverflowing(isTextOverflowing(ref.current))
  }, [])

  useEffect(() => {
    measure()
    if (!ref.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [measure, text])

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            ref={ref}
            className={cn('block min-w-0 truncate', className)}
            onMouseEnter={measure}
            onFocus={measure}
          >
            {children ?? text}
          </span>
        </TooltipTrigger>
        {overflowing ? (
          <TooltipContent side="top" className="max-w-sm whitespace-normal break-words">
            {text}
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  )
}
