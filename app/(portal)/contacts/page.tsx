import type { Metadata } from "next";
import { ContactsWorkspace } from "@/components/contacts/contacts-workspace";

export const metadata: Metadata = {
  title: "Contacts · Hemas Connect synthetic demo",
  description: "A masked synthetic contact workspace for multilingual preferences, consent evidence and suppression controls.",
};

export default function ContactsPage() {
  return <ContactsWorkspace />;
}
