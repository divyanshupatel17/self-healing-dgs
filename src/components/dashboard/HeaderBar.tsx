import { Menu, MessageSquare, HelpCircle } from "lucide-react";

const HeaderBar = () => (
  <header className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
    <div className="flex items-center gap-3">
      <Menu className="w-5 h-5 text-muted-foreground" />
      <img src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="Digital Twin Logo" className="w-6 h-6" />
      <h1 className="text-sm font-medium text-foreground">
        Self-Healing Monocular Digital Twin System for Autonomous Vehicles
      </h1>
    </div>
    <div className="flex items-center gap-3">
      <MessageSquare className="w-4 h-4 text-muted-foreground" />
      <HelpCircle className="w-4 h-4 text-muted-foreground" />
    </div>
  </header>
);

export default HeaderBar;
