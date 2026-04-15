import { Mountain, FileSearch, Map, Building2, Link } from 'lucide-react';

export function EmptyState() {
  const suggestions = [
    {
      icon: FileSearch,
      title: 'Search Documents',
      description: 'Find information in your indexed files',
    },
    {
      icon: Map,
      title: 'Parcel Information',
      description: 'Ask about specific land parcels',
    },
    {
      icon: Building2,
      title: 'Zoning Analysis',
      description: 'Get zoning and development details',
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-6 animate-fade-in">
        <Mountain className="h-10 w-10 text-primary" />
      </div>
      
      <h2 className="font-display text-2xl font-semibold mb-2 animate-slide-up">
        Welcome to Terra Chat
      </h2>
      <p className="text-muted-foreground max-w-md mb-8 animate-slide-up" style={{ animationDelay: '0.1s' }}>
        Your AI assistant for land development intelligence. Ask questions about your documents, parcels, and projects.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full">
        {suggestions.map((item, index) => (
          <div
            key={item.title}
            className="p-4 rounded-xl bg-card border border-border hover:border-primary/30 hover:shadow-soft transition-all cursor-pointer animate-slide-up"
            style={{ animationDelay: `${0.2 + index * 0.1}s` }}
          >
            <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center mb-3">
              <item.icon className="h-5 w-5 text-secondary-foreground" />
            </div>
            <h3 className="font-medium text-sm mb-1">{item.title}</h3>
            <p className="text-xs text-muted-foreground">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
