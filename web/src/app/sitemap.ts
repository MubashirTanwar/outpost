import type { MetadataRoute } from "next";
import { COURSES } from "@/lib/courses";
import { ALL_LESSONS } from "@/lib/endgames";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({ url: `${SITE_URL}${path}`, changeFrequency: "weekly", priority });
  return [
    page("/", 1),
    page("/analysis", 0.8),
    page("/courses", 0.9),
    page("/endgames", 0.9),
    ...COURSES.map((c) => page(`/courses/${c.id}`, 0.7)),
    ...ALL_LESSONS.map((l) => page(`/endgames/${l.id}`, 0.6)),
  ];
}
