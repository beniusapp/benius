import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Aperture, X, Download, Loader2, Image } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

interface StudentMe {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  schoolName: string;
  schoolCode: string;
}

interface GalleryItem {
  id: number;
  schoolId: number;
  title: string;
  description: string | null;
  eventTag: string | null;
  imageUrl: string;
  approved: boolean;
  createdAt: string;
}

function SkeletonCard() {
  return (
    <div className="break-inside-avoid mb-3 rounded-2xl overflow-hidden bg-white border border-emerald-50 shadow-sm animate-pulse">
      <div className="bg-gray-200 w-full" style={{ height: `${160 + Math.random() * 80}px` }} />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-gray-200 rounded w-3/4" />
        <div className="h-2.5 bg-gray-100 rounded w-1/2" />
      </div>
    </div>
  );
}

export default function StudentGallery() {
  const [, setLocation] = useLocation();
  const [activeTag, setActiveTag] = useState<string>("all");
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery<string[]>({
    queryKey: ["/api/student/gallery/tags"],
    enabled: !!student,
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery<GalleryItem[]>({
    queryKey: activeTag === "all"
      ? ["/api/student/gallery"]
      : ["/api/student/gallery", activeTag],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!student,
  });

  const isLoading = studentLoading || itemsLoading;

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf4] flex flex-col">

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-30 bg-[#10b981] shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors flex-shrink-0"
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight">School Gallery</p>
            <p className="text-emerald-100 text-xs">{student.schoolName}</p>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20">
            <Aperture className="w-3.5 h-3.5 text-white" />
            <span className="text-white text-xs font-semibold">{items.length} photos</span>
          </div>
        </div>
      </header>

      {/* ── Tag Filter Bar ── */}
      <div className="sticky top-[60px] z-20 bg-[#f0fdf4]/90 backdrop-blur-sm border-b border-emerald-100">
        <div className="max-w-5xl mx-auto px-4 py-2">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            <button
              onClick={() => setActiveTag("all")}
              className={`flex-shrink-0 px-4 h-9 rounded-full text-sm font-semibold transition-all ${
                activeTag === "all"
                  ? "bg-[#10b981] text-white shadow-sm"
                  : "bg-white text-gray-600 border border-emerald-100 hover:border-[#10b981] hover:text-[#10b981]"
              }`}
              data-testid="filter-all"
            >
              All Albums
            </button>
            {tagsLoading
              ? [1, 2, 3].map(i => (
                  <div key={i} className="flex-shrink-0 h-9 w-24 rounded-full bg-white animate-pulse border border-emerald-100" />
                ))
              : tags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(tag)}
                    className={`flex-shrink-0 px-4 h-9 rounded-full text-sm font-semibold transition-all whitespace-nowrap ${
                      activeTag === tag
                        ? "bg-[#10b981] text-white shadow-sm"
                        : "bg-white text-gray-600 border border-emerald-100 hover:border-[#10b981] hover:text-[#10b981]"
                    }`}
                    data-testid={`filter-tag-${tag}`}
                  >
                    {tag}
                  </button>
                ))}
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-5">

        {/* ── Loading Skeletons ── */}
        {isLoading && (
          <div className="columns-2 md:columns-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* ── Empty State ── */}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
            <div className="w-24 h-24 rounded-3xl bg-white border border-emerald-100 shadow-sm flex items-center justify-center">
              <Image className="w-12 h-12 text-emerald-200" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-700">No Photos Yet</h3>
              <p className="text-sm text-gray-400 mt-1 max-w-xs">
                {student.schoolName} hasn't uploaded any gallery photos here yet.
              </p>
            </div>
          </div>
        )}

        {/* ── Masonry Grid ── */}
        {!isLoading && items.length > 0 && (
          <div className="columns-2 md:columns-4 gap-3">
            {items.map(item => (
              <div
                key={item.id}
                className="break-inside-avoid mb-3 rounded-2xl overflow-hidden bg-white border border-emerald-50 shadow-sm cursor-pointer group hover:shadow-md transition-shadow"
                onClick={() => setLightbox(item)}
                data-testid={`card-gallery-${item.id}`}
              >
                <div className="relative overflow-hidden">
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    className="w-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                    onError={e => { (e.target as HTMLImageElement).src = "https://placehold.co/400x300/d1fae5/10b981?text=Photo"; }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </div>
                <div className="p-2.5">
                  <p className="text-xs font-semibold text-gray-800 line-clamp-1">{item.title}</p>
                  {item.eventTag && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-emerald-50 text-[#10b981] text-[10px] font-semibold border border-emerald-100">
                      {item.eventTag}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── Lightbox Overlay ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          onClick={() => setLightbox(null)}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <div className="min-w-0 flex-1">
              <p className="text-white font-bold text-sm truncate">{lightbox.title}</p>
              <p className="text-gray-400 text-xs mt-0.5">
                {new Date(lightbox.createdAt).toLocaleDateString("en-GB")}
                {lightbox.eventTag ? ` · ${lightbox.eventTag}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
              <a
                href={lightbox.imageUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 h-10 rounded-xl bg-[#10b981] hover:bg-[#059669] text-white text-sm font-semibold transition-colors"
                data-testid="button-download"
                onClick={e => e.stopPropagation()}
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Save</span>
              </a>
              <button
                onClick={() => setLightbox(null)}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                data-testid="button-close-lightbox"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Image */}
          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden" onClick={() => setLightbox(null)}>
            <img
              src={lightbox.imageUrl}
              alt={lightbox.title}
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
              onClick={e => e.stopPropagation()}
              onError={e => { (e.target as HTMLImageElement).src = "https://placehold.co/800x600/d1fae5/10b981?text=Photo"; }}
            />
          </div>

          {/* Caption */}
          {lightbox.description && (
            <div className="px-4 pb-4 flex-shrink-0" onClick={e => e.stopPropagation()}>
              <p className="text-gray-300 text-sm text-center">{lightbox.description}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
