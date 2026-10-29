import { Hydrator } from "@/components/shell/Hydrator";

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <Hydrator>
      <div className="min-h-screen bg-white">{children}</div>
    </Hydrator>
  );
}
