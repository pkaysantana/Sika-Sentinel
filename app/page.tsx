"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const Spline = dynamic(() => import("@splinetool/react-spline"), { ssr: false });

export default function LandingPage() {
  const router = useRouter();

  return (
    <div
      className="relative w-full h-screen overflow-hidden bg-gray-950 cursor-pointer select-none"
      onClick={() => router.push("/dashboard")}
    >
      <div className="absolute inset-0 z-0 pointer-events-none">
        <Spline scene="https://prod.spline.design/saygf3z2IECInGOc/scene.splinecode" />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center h-full pointer-events-none">
        <div className="absolute bottom-12 flex flex-col items-center gap-2 animate-pulse">
          <span className="text-sm text-gray-400 tracking-widest uppercase">
            Click anywhere to enter
          </span>
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    </div>
  );
}
