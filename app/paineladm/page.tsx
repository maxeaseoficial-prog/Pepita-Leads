import type { Metadata } from "next";
import { AdminPanel } from "@/components/admin-panel";

export const metadata:Metadata={
  title:"Painel administrativo — Pepita",
  robots:{index:false,follow:false}
};

export default function PainelAdmPage() {
  return <AdminPanel/>;
}