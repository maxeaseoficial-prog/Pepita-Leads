import type { ReactNode, SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

function Base({children,...props}:Props & {children:ReactNode}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

export const ChatIcon=(p:Props)=><Base {...p}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-7a4 4 0 0 1-1-2.6V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4z"/></Base>;
export const SearchIcon=(p:Props)=><Base {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></Base>;
export const ResultsIcon=(p:Props)=><Base {...p}><path d="M4 6h16M4 12h16M4 18h16"/><path d="M2 6h.01M2 12h.01M2 18h.01"/></Base>;
export const ExportIcon=(p:Props)=><Base {...p}><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></Base>;
export const HistoryIcon=(p:Props)=><Base {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></Base>;
export const SettingsIcon=(p:Props)=><Base {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></Base>;
export const SendIcon=(p:Props)=><Base {...p}><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></Base>;
export const MicIcon=(p:Props)=><Base {...p}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></Base>;
export const StopIcon=(p:Props)=><Base {...p}><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/></Base>;
export const ArrowUpIcon=(p:Props)=><Base {...p}><path d="M12 20V4M6 10l6-6 6 6"/></Base>;
export const FilterIcon=(p:Props)=><Base {...p}><path d="M4 5h16M7 12h10M10 19h4"/></Base>;
export const BuildingIcon=(p:Props)=><Base {...p}><path d="M4 21V5l8-3 8 3v16"/><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01M2 21h20"/></Base>;
export const FileIcon=(p:Props)=><Base {...p}><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></Base>;
export const MapPinIcon=(p:Props)=><Base {...p}><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></Base>;
export const PhoneIcon=(p:Props)=><Base {...p}><path d="M22 16.9v3a2 2 0 0 1-2.2 2A20 20 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L9 11a16 16 0 0 0 4 4l1.3-1.3a2 2 0 0 1 2.1-.5c1 .3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/></Base>;
export const GlobeIcon=(p:Props)=><Base {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></Base>;
export const CloseIcon=(p:Props)=><Base {...p}><path d="m6 6 12 12M18 6 6 18"/></Base>;
export const ArrowRightIcon=(p:Props)=><Base {...p}><path d="M5 12h14m-5-5 5 5-5 5"/></Base>;
export const SparkIcon=(p:Props)=><Base {...p}><path d="m12 3 1.2 4.3L17.5 9l-4.3 1.7L12 15l-1.2-4.3L6.5 9l4.3-1.7Z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7Z"/></Base>;
export const KanbanIcon=(p:Props)=><Base {...p}><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/></Base>;
export const PlusIcon=(p:Props)=><Base {...p}><path d="M12 5v14M5 12h14"/></Base>;
export const DragIcon=(p:Props)=><Base {...p}><circle cx="9" cy="6" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r=".7" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r=".7" fill="currentColor" stroke="none"/></Base>;
export const CommentIcon=(p:Props)=><Base {...p}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-7a4 4 0 0 1-1-2.6V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/></Base>;
export const NoteIcon=(p:Props)=><Base {...p}><path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></Base>;
export const MailIcon=(p:Props)=><Base {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></Base>;
export const TrashIcon=(p:Props)=><Base {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></Base>;
export const EditIcon=(p:Props)=><Base {...p}><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z"/><path d="m14 7 3 3"/></Base>;
