import { STATIC_PAGE_IMAGES } from "@/lib/imageManifest";

export const STATIC_PAGE_CONTENT = {
  home: {
    eyebrow: "Navigator",
    title: "Continue With",
    highlight: "Voyagr",
    subtitle:
      "The homepage is the immersive planning surface. This route gives you a fast orientation page with direct links into the live experience.",
    description:
      "Use the main landing page for destinations, the interactive world map, and restaurant discovery. Jump into the trip generator whenever you are ready to convert inspiration into an itinerary.",
    image: STATIC_PAGE_IMAGES.home,
    imageAlt: "Traveler overlooking mountains",
    actions: [
      { label: "Open Main Experience", to: "/" },
      { label: "Create Trip", to: "/create-trip", variant: "secondary" },
    ],
    stats: [
      { value: "4", label: "Core homepage modules" },
      { value: "AI", label: "Planning engine" },
      { value: "Live", label: "Interactive map markers" },
    ],
    cards: [
      {
        eyebrow: "Landing",
        title: "Immersive homepage",
        description:
          "Hero, destinations, the full atlas map, and restaurant recommendations share one consistent design system.",
      },
      {
        eyebrow: "Trip builder",
        title: "Guided planning flow",
        description:
          "Trip creation remains the action-focused route for secure itinerary generation and persistence.",
      },
      {
        eyebrow: "Account",
        title: "Saved trip continuity",
        description:
          "Sign in to keep destination ideas, AI itineraries, and revisit flows connected to your profile.",
      },
    ],
  },
  about: {
    eyebrow: "About",
    title: "Why Travelers Use",
    highlight: "Voyagr",
    subtitle:
      "A design-led travel planner that turns destination inspiration into practical itineraries.",
    description:
      "Voyagr brings discovery, itinerary generation, maps, and saved trip management into one polished interface so planning feels cohesive instead of fragmented.",
    image: STATIC_PAGE_IMAGES.about,
    imageAlt: "Scenic mountain destination",
    actions: [
      { label: "Explore Destinations", to: "/#destinations" },
      { label: "Start Planning", to: "/create-trip", variant: "secondary" },
    ],
    stats: [
      { value: "AI", label: "Itinerary generation" },
      { value: "Map", label: "World-scale discovery" },
      { value: "Trips", label: "Saved in your account" },
    ],
    cards: [
      {
        eyebrow: "Focus",
        title: "Smart trip framing",
        description:
          "Travelers describe destination, budget, duration, and group type once, then reuse that context across the product.",
      },
      {
        eyebrow: "Experience",
        title: "Visual-first planning",
        description:
          "The UI stays premium and readable while surfacing destinations, dining, and routes with strong visual hierarchy.",
      },
      {
        eyebrow: "Reliability",
        title: "Secure personal planning",
        description:
          "Trips are tied to authenticated users so itineraries remain private and recoverable across sessions.",
      },
    ],
  },
  contact: {
    eyebrow: "Contact",
    title: "Talk To The",
    highlight: "Voyagr Team",
    subtitle:
      "Reach the project team directly for questions, product feedback, or implementation discussions.",
    description:
      "For travel-planning support, feature suggestions, or collaboration inquiries, use the shared project inbox or contact a team member below.",
    image: STATIC_PAGE_IMAGES.contact,
    imageAlt: "A traveler checking routes on a phone",
    actions: [
      {
        label: "Email Project Inbox",
        href: "mailto:travelplanner.team@gmail.com",
      },
      { label: "Visit Help Center", to: "/help-center", variant: "secondary" },
    ],
    stats: [
      { value: "1", label: "Shared inbox" },
      { value: "4", label: "Core contributors" },
      { value: "Fast", label: "Feedback loop" },
    ],
    cards: [
      {
        eyebrow: "Inbox",
        title: "Project email",
        description: "travelplanner.team@gmail.com",
        meta: "Primary contact for support and collaboration.",
        link: { label: "Send email", href: "mailto:travelplanner.team@gmail.com" },
      },
      {
        eyebrow: "Team",
        title: "Aggimalla Abhishek",
        description: "23bds004@iiitdwd.ac.in",
        meta: "Frontend, UI system, and product implementation.",
        link: { label: "Email Abhishek", href: "mailto:23bds004@iiitdwd.ac.in" },
      },
      {
        eyebrow: "Team",
        title: "Sundaram",
        description: "23bds060@iiitdwd.ac.in",
        meta: "Project delivery and engineering collaboration.",
        link: { label: "Email Sundaram", href: "mailto:23bds060@iiitdwd.ac.in" },
      },
      {
        eyebrow: "Team",
        title: "Sambhav Mishra",
        description: "23bds050@iiitdwd.ac.in",
        meta: "Platform iteration and feature support.",
        link: { label: "Email Sambhav", href: "mailto:23bds050@iiitdwd.ac.in" },
      },
      {
        eyebrow: "Team",
        title: "Nenavath Likhith",
        description: "23bds037@iiitdwd.ac.in",
        meta: "Coordination across planning and product execution.",
        link: { label: "Email Likhith", href: "mailto:23bds037@iiitdwd.ac.in" },
      },
    ],
  },
  features: {
    eyebrow: "Features",
    title: "Everything Needed To Plan",
    highlight: "Better Trips",
    subtitle:
      "Voyagr combines destination discovery, AI generation, and saved planning flows into one interface.",
    description:
      "Instead of scattering work across search tabs, notes, and maps, the product keeps the highest-value travel planning tasks inside one consistent experience.",
    image: STATIC_PAGE_IMAGES.features,
    imageAlt: "Travel planning desk with maps and devices",
    actions: [
      { label: "Create Trip", to: "/create-trip" },
      { label: "Open Map", to: "/#map-section", variant: "secondary" },
    ],
    stats: [
      { value: "AI", label: "Trip generation" },
      { value: "28+", label: "World map hotspots" },
      { value: "Data-rich", label: "Destination cards" },
    ],
    cards: [
      {
        eyebrow: "Planner",
        title: "Guided trip generation",
        description:
          "Capture destination, duration, traveler type, and budget, then convert that input into a structured itinerary.",
      },
      {
        eyebrow: "Discovery",
        title: "Curated destinations",
        description:
          "Browse a larger destination catalog with hover states, image-rich cards, and smoother transitions.",
      },
      {
        eyebrow: "Atlas",
        title: "Interactive world map",
        description:
          "Explore globally distributed hotspots with hover previews, detail modals, and direct plan-trip actions.",
      },
      {
        eyebrow: "Saved trips",
        title: "Private trip history",
        description:
          "Signed-in travelers can revisit previous itineraries without losing context between sessions.",
      },
    ],
  },
  ourStory: {
    eyebrow: "Story",
    title: "The Journey Behind",
    highlight: "Voyagr",
    subtitle:
      "Built to reduce planning friction and make travel software feel more intentional than a form stack.",
    description:
      "The project started from a practical gap: travelers need inspiration, structure, and persistence in one place, not a loose collection of disconnected tools.",
    image: STATIC_PAGE_IMAGES.ourStory,
    imageAlt: "Travelers walking through a scenic street",
    actions: [
      { label: "See Features", to: "/features" },
      { label: "Meet the Team", to: "/team", variant: "secondary" },
    ],
    stats: [
      { value: "Design-first", label: "UI foundation" },
      { value: "AI-backed", label: "Planning workflow" },
      { value: "Incremental", label: "Improvement strategy" },
    ],
    cards: [
      {
        eyebrow: "Problem",
        title: "Too many scattered tools",
        description:
          "Trip planning often bounces between maps, docs, messaging, and recommendation sites before a real plan exists.",
      },
      {
        eyebrow: "Response",
        title: "One coherent planning surface",
        description:
          "Voyagr narrows that spread by connecting inspiration, selection, generation, and saved access.",
      },
      {
        eyebrow: "Direction",
        title: "A stronger product core",
        description:
          "The current architecture is aimed at a stable, secure foundation before new features expand the scope.",
      },
    ],
  },
  team: {
    eyebrow: "Team",
    title: "People Shaping",
    highlight: "Voyagr",
    subtitle:
      "A small product and engineering team focused on turning travel planning into a more guided experience.",
    description:
      "The team combines frontend implementation, architecture review, backend hardening, and product refinement to keep the app moving toward a production-ready system.",
    image: STATIC_PAGE_IMAGES.team,
    imageAlt: "Team collaborating around a table",
    actions: [
      { label: "Contact Us", to: "/contact" },
      { label: "Open Careers", to: "/careers", variant: "secondary" },
    ],
    stats: [
      { value: "UI", label: "Design consistency" },
      { value: "API", label: "Secure backend boundary" },
      { value: "QA", label: "Verification-driven delivery" },
    ],
    cards: [
      {
        eyebrow: "Craft",
        title: "Frontend and UX",
        description:
          "Layout consistency, map interactions, image reliability, and route-level experience quality are active product priorities.",
      },
      {
        eyebrow: "Architecture",
        title: "Backend hardening",
        description:
          "The app now emphasizes authenticated trip ownership and safer API boundaries for trust-sensitive operations.",
      },
      {
        eyebrow: "Delivery",
        title: "Iterative improvement",
        description:
          "Features are being improved in passes so security, stability, and design quality advance together.",
      },
    ],
  },
  careers: {
    eyebrow: "Careers",
    title: "Help Build Smarter",
    highlight: "Travel Tools",
    subtitle:
      "Voyagr is still evolving, but the direction is clear: design-led travel software with stronger technical foundations.",
    description:
      "We are interested in collaborators who care about polished interfaces, disciplined implementation, and making complex planning feel simple to the user.",
    image: STATIC_PAGE_IMAGES.careers,
    imageAlt: "People working on laptops in a collaborative workspace",
    actions: [
      { label: "Contact Team", to: "/contact" },
      { label: "Read Our Story", to: "/our-story", variant: "secondary" },
    ],
    stats: [
      { value: "Product", label: "Travel planning" },
      { value: "Design", label: "Premium UI systems" },
      { value: "Engineering", label: "Incremental hardening" },
    ],
    cards: [
      {
        eyebrow: "Looking for",
        title: "Frontend specialists",
        description:
          "Engineers who can translate visual ambition into maintainable React interfaces without sacrificing performance.",
      },
      {
        eyebrow: "Looking for",
        title: "Platform-minded developers",
        description:
          "Contributors who can strengthen auth, route integrity, validation, and backend integration quality.",
      },
      {
        eyebrow: "Looking for",
        title: "UX-aware builders",
        description:
          "People who notice small friction points and resolve them through design systems, not isolated patches.",
      },
    ],
  },
  privacyPolicy: {
    eyebrow: "Privacy",
    title: "How",
    highlight: "Voyagr",
    subtitle:
      "The app is designed to keep itinerary data tied to the authenticated user and away from public exposure.",
    description:
      "Trip generation, retrieval, and list views are expected to follow account ownership rules, and UI decisions are aligned around minimizing accidental data exposure.",
    image: STATIC_PAGE_IMAGES.privacyPolicy,
    imageAlt: "Laptop with security lock icon",
    actions: [
      { label: "Review API Docs", to: "/api-docs" },
      { label: "Get Support", to: "/help-center", variant: "secondary" },
    ],
    stats: [
      { value: "Auth", label: "Google sign-in" },
      { value: "Trips", label: "Owner-only retrieval" },
      { value: "UI", label: "No public trip listing" },
    ],
    cards: [
      {
        eyebrow: "Collected",
        title: "Trip planning data",
        description:
          "Destination choices, budget selections, travelers, and generated itinerary details are used to build and display your trip.",
      },
      {
        eyebrow: "Protected",
        title: "Authenticated access",
        description:
          "Saved trips are intended to be available only to the signed-in user who owns them.",
      },
      {
        eyebrow: "Handled carefully",
        title: "Minimal visibility",
        description:
          "The UI avoids exposing sensitive trip records unless a valid authenticated session is present.",
      },
    ],
  },
  helpCenter: {
    eyebrow: "Support",
    title: "Get Help Without Losing",
    highlight: "Momentum",
    subtitle:
      "Use these starting points when you need help with login, itinerary generation, or navigating the planning flow.",
    description:
      "Most issues are easier to resolve when you know whether the problem is authentication, input validation, or generated-content quality. Start with the section that matches the symptom.",
    image: STATIC_PAGE_IMAGES.helpCenter,
    imageAlt: "Support team in conversation",
    actions: [
      { label: "Email Support", to: "/contact" },
      { label: "Open FAQs", to: "/faqs", variant: "secondary" },
    ],
    stats: [
      { value: "Auth", label: "Sign-in support" },
      { value: "Trips", label: "Saved itinerary help" },
      { value: "Map", label: "Discovery guidance" },
    ],
    cards: [
      {
        eyebrow: "Sign-in",
        title: "Session and access issues",
        description:
          "If your trips are not visible, confirm the correct Google account is active before reloading the page.",
      },
      {
        eyebrow: "Generation",
        title: "Trip request validation",
        description:
          "Destination, duration, budget, and traveler type must all be present before itinerary generation can proceed.",
      },
      {
        eyebrow: "Navigation",
        title: "Finding the right page",
        description:
          "Use the homepage for discovery, the trip builder for generation, and My Trips for saved itinerary access.",
      },
    ],
  },
  faqs: {
    eyebrow: "FAQ",
    title: "Common Questions About",
    highlight: "Voyagr",
    subtitle:
      "The fastest way to answer the recurring product questions travelers ask while planning.",
    description:
      "These answers are focused on how the current product works today: destination discovery, secure login, itinerary generation, and saved trip access.",
    image: STATIC_PAGE_IMAGES.faqs,
    imageAlt: "Notebook and coffee on a desk",
    actions: [
      { label: "Visit Help Center", to: "/help-center" },
      { label: "Contact Team", to: "/contact", variant: "secondary" },
    ],
    stats: [
      { value: "How", label: "Trip generation works" },
      { value: "Where", label: "Saved trips live" },
      { value: "Who", label: "Can access a trip" },
    ],
    cards: [
      {
        eyebrow: "Q1",
        title: "Do I need an account?",
        description:
          "You can browse discovery content without signing in, but saved itineraries and secure trip generation require authentication.",
      },
      {
        eyebrow: "Q2",
        title: "Can I reopen a previous trip?",
        description:
          "Yes. Signed-in users can return to My Trips and reopen itineraries that belong to their account.",
      },
      {
        eyebrow: "Q3",
        title: "Why do some images change?",
        description:
          "The app now uses stronger fallback logic so travel cards, hotels, and places remain visually complete even when a remote image fails.",
      },
    ],
  },
  feedback: {
    eyebrow: "Feedback",
    title: "Help Improve",
    highlight: "Voyagr",
    subtitle:
      "The product is being hardened in iterative passes, so feedback on friction points is especially useful right now.",
    description:
      "Strong feedback is specific: tell us which page you were on, what action you took, and what felt broken, confusing, or incomplete.",
    image: STATIC_PAGE_IMAGES.feedback,
    imageAlt: "Small team reviewing product ideas",
    actions: [
      { label: "Send Feedback", href: "mailto:travelplanner.team@gmail.com" },
      { label: "Open Contact Page", to: "/contact", variant: "secondary" },
    ],
    stats: [
      { value: "UX", label: "Flow and clarity" },
      { value: "Data", label: "Image/content accuracy" },
      { value: "Theme", label: "Visual consistency" },
    ],
    cards: [
      {
        eyebrow: "Useful input",
        title: "Design quality",
        description:
          "Call out spacing issues, contrast problems, or components that feel inconsistent across routes.",
      },
      {
        eyebrow: "Useful input",
        title: "Planning friction",
        description:
          "Tell us where the discovery-to-planning handoff feels confusing or where actions are missing.",
      },
      {
        eyebrow: "Useful input",
        title: "Broken or weak content",
        description:
          "Report missing images, low-quality fallbacks, or destination details that do not match the visible UI.",
      },
    ],
  },
  travelGuides: {
    eyebrow: "Guides",
    title: "Curated Travel",
    highlight: "Guidance",
    subtitle:
      "Use these guide themes to approach destinations with stronger intent before generating a trip.",
    description:
      "Guides in Voyagr are less about long-form editorial content and more about helping travelers choose the right kind of experience: food-first, culture-heavy, scenic, or adventurous.",
    image: STATIC_PAGE_IMAGES.travelGuides,
    imageAlt: "Aerial coastline travel view",
    actions: [
      { label: "Browse Destinations", to: "/#destinations" },
      { label: "Open Map Atlas", to: "/#map-section", variant: "secondary" },
    ],
    stats: [
      { value: "Food", label: "Culinary planning" },
      { value: "Culture", label: "History-rich routes" },
      { value: "Scenic", label: "Map-led discovery" },
    ],
    cards: [
      {
        eyebrow: "Theme",
        title: "Food-led itineraries",
        description:
          "Start with restaurant-rich cities and use the dining section to layer in memorable stops.",
      },
      {
        eyebrow: "Theme",
        title: "Culture and heritage",
        description:
          "Choose destinations with dense landmark clusters when your trip should prioritize history and local identity.",
      },
      {
        eyebrow: "Theme",
        title: "Adventure and scenery",
        description:
          "Use the map to identify destinations where geography itself shapes the trip, then build around duration and pace.",
      },
    ],
  },
  aiTips: {
    eyebrow: "AI Tips",
    title: "How To Get Better Results From",
    highlight: "AI Planning",
    subtitle:
      "The itinerary generator works best when inputs are concrete, realistic, and matched to the kind of trip you actually want.",
    description:
      "Treat the trip builder like a strong brief: give it the destination, realistic day count, a budget range, and the right traveler profile so the generated plan starts closer to your actual needs.",
    image: STATIC_PAGE_IMAGES.aiTips,
    imageAlt: "Notebook with AI planning notes",
    actions: [
      { label: "Open Trip Builder", to: "/create-trip" },
      { label: "See Features", to: "/features", variant: "secondary" },
    ],
    stats: [
      { value: "Clear", label: "Destination naming" },
      { value: "Realistic", label: "Trip duration" },
      { value: "Aligned", label: "Traveler type and budget" },
    ],
    cards: [
      {
        eyebrow: "Tip 1",
        title: "Use a specific destination",
        description:
          "City and country names usually lead to better image matching, place details, and hotel suggestions than vague regions.",
      },
      {
        eyebrow: "Tip 2",
        title: "Match days to trip type",
        description:
          "Short city breaks and long scenic trips should not share the same day count expectations.",
      },
      {
        eyebrow: "Tip 3",
        title: "Choose the right traveler profile",
        description:
          "Solo, couple, family, and group trips often imply different pacing, spending patterns, and activity mixes.",
      },
    ],
  },
  blog: {
    eyebrow: "Journal",
    title: "Product Notes And Travel",
    highlight: "Stories",
    subtitle:
      "A place for future editorial content, travel observations, and updates on how the app is evolving.",
    description:
      "The content layer is intentionally lightweight for now. The priority is shipping a stable, coherent product core before expanding into a larger publishing surface.",
    image: STATIC_PAGE_IMAGES.blog,
    imageAlt: "Travel journal on a desk",
    actions: [
      { label: "Back to Homepage", to: "/" },
      { label: "Read Our Story", to: "/our-story", variant: "secondary" },
    ],
    stats: [
      { value: "Roadmap", label: "Product evolution" },
      { value: "Design", label: "Interface decisions" },
      { value: "Travel", label: "Planning insights" },
    ],
    cards: [
      {
        eyebrow: "Soon",
        title: "Release notes",
        description:
          "Progress updates will focus on substantial product changes such as route integrity, auth hardening, and UI system improvements.",
      },
      {
        eyebrow: "Soon",
        title: "Travel editorials",
        description:
          "Destination and planning articles will make more sense once the main application flows are fully stable.",
      },
      {
        eyebrow: "Now",
        title: "Product-first focus",
        description:
          "The current emphasis remains on the usability and trustworthiness of the planner itself.",
      },
    ],
  },
  apiDocs: {
    eyebrow: "API",
    title: "Backend Routes That Power",
    highlight: "Voyagr",
    subtitle:
      "The secured backend keeps trust-sensitive work away from the browser and protects trip ownership.",
    description:
      "Trip APIs expect authenticated requests, validate input before generation, and only return data to the user who owns the trip record.",
    image: STATIC_PAGE_IMAGES.apiDocs,
    imageAlt: "Code editor on a laptop",
    actions: [
      { label: "Open Trip Builder", to: "/create-trip" },
      { label: "Read Privacy Notes", to: "/privacy-policy", variant: "secondary" },
    ],
    stats: [
      { value: "POST", label: "/api/trips/generate" },
      { value: "GET", label: "/api/trips/:tripId" },
      { value: "GET", label: "/api/trips/:tripId/recommendations" },
      { value: "GET", label: "/api/my-trips" },
    ],
    cards: [
      {
        eyebrow: "POST",
        title: "/api/trips/generate",
        description:
          "Accepts normalized selection input, generates the itinerary, validates the result, and stores the trip for the authenticated user.",
        meta: "Use when creating a new trip from the guided planner.",
      },
      {
        eyebrow: "GET",
        title: "/api/trips/:tripId",
        description:
          "Returns a single saved trip only when the requesting user owns the trip identifier being requested.",
        meta: "Used by the trip detail view.",
      },
      {
        eyebrow: "GET",
        title: "/api/trips/:tripId/recommendations",
        description:
          "Loads destination-based hotels and restaurants with provider-aware fallback behavior and short-term caching.",
        meta: "Used by the trip detail recommendations sections.",
      },
      {
        eyebrow: "GET",
        title: "/api/my-trips",
        description:
          "Loads the authenticated user’s saved trip list so the planner can resume previous itineraries.",
        meta: "Used by the My Trips page.",
      },
    ],
  },
};
