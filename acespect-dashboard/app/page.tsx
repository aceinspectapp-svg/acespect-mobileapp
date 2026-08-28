"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken, getRole, homeForRole } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? homeForRole(getRole()) : "/login");
  }, [router]);
  return <div className="container muted">Loading…</div>;
}
