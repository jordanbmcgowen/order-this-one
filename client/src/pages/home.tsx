import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  MapPin,
  Star,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  Utensils,
  Flame,
  Loader2,
  Navigation,
  Search,
  Sparkles,
  Camera,
  Quote,
  Link as LinkIcon,
  ThumbsUp,
  ThumbsDown,
  ShieldCheck,
  ShieldQuestion,
  ShieldAlert,
  X,
} from "lucide-react";
import type { RestaurantResult, DishRecommendation, Confidence } from "@shared/schema";

interface AutocompletePrediction {
  placeId: string;
  name: string;
  description: string;
}

type AppState = "locating" | "browse" | "loading-rec" | "result";

const CONFIDENCE_META: Record<Confidence, { label: string; icon: typeof ShieldCheck; className: string }> = {
  high: {
    label: "Strong evidence",
    icon: ShieldCheck,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  medium: {
    label: "Good evidence",
    icon: ShieldQuestion,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  low: {
    label: "Limited evidence",
    icon: ShieldAlert,
    className: "bg-muted text-muted-foreground border-border",
  },
};

const LOADING_STEPS = [
  "Reading Google reviews...",
  "Searching the web for local favorites...",
  "Checking Reddit and food press...",
  "Cross-referencing the top contenders...",
  "Settling on the one dish...",
];

const photoUrl = (name: string) => `/api/restaurants/photo?name=${encodeURIComponent(name)}`;

function PhotoGallery({ photoNames, alt }: { photoNames: string[]; alt: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());
  const validIndices = photoNames.map((_, i) => i).filter((i) => !failedImages.has(i));

  if (validIndices.length === 0) return null;

  const currentValidPosition = validIndices.indexOf(activeIndex);
  const safePosition = currentValidPosition >= 0 ? currentValidPosition : 0;
  const safeActiveIndex = validIndices[safePosition] ?? validIndices[0];

  return (
    <div className="mt-4" data-testid="photo-gallery">
      <div className="relative rounded-xl overflow-hidden bg-muted aspect-[4/3]">
        <img
          src={photoUrl(photoNames[safeActiveIndex])}
          alt={alt}
          className="w-full h-full object-cover"
          onError={() => setFailedImages((prev) => new Set(prev).add(safeActiveIndex))}
        />
        {validIndices.length > 1 && (
          <>
            <button
              onClick={() => {
                const prev = safePosition > 0 ? validIndices[safePosition - 1] : validIndices[validIndices.length - 1];
                setActiveIndex(prev);
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-colors"
              data-testid="photo-prev"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const next = safePosition < validIndices.length - 1 ? validIndices[safePosition + 1] : validIndices[0];
                setActiveIndex(next);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-colors"
              data-testid="photo-next"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
        <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
          <Camera className="w-3 h-3" />
          {safePosition + 1}/{validIndices.length}
        </div>
      </div>
      {validIndices.length > 1 && (
        <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1 scrollbar-hide">
          {validIndices.map((origIndex, i) => (
            <button
              key={origIndex}
              onClick={() => setActiveIndex(origIndex)}
              className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                origIndex === safeActiveIndex
                  ? "border-primary ring-1 ring-primary/30"
                  : "border-transparent opacity-60 hover:opacity-100"
              }`}
              data-testid={`photo-thumb-${i}`}
            >
              <img
                src={photoUrl(photoNames[origIndex])}
                alt={`Photo ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setFailedImages((prev) => new Set(prev).add(origIndex))}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingResearch({ restaurantName }: { restaurantName: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 9000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-background">
      <div className="flex flex-col items-center gap-6 text-center max-w-sm">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <Flame className="w-10 h-10 text-primary" />
          </div>
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
            <Loader2 className="w-3.5 h-3.5 text-primary-foreground animate-spin" />
          </div>
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Researching {restaurantName}</h1>
          <p className="text-sm text-muted-foreground mt-2" data-testid="loading-step">
            {LOADING_STEPS[step]}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-3">
            First lookup for a restaurant runs a deep review-and-web research pass — it can take a minute. It's instant after that.
          </p>
        </div>
      </div>
    </div>
  );
}

function ResultView({
  restaurant,
  recommendation,
  onBack,
}: {
  restaurant: RestaurantResult;
  recommendation: DishRecommendation;
  onBack: () => void;
}) {
  const { toast } = useToast();
  // Votes are remembered per place+dish so one diner can't re-vote their way
  // to the regeneration threshold from a single device.
  const voteKey = `oto-vote:${restaurant.placeId}:${recommendation.dishName.toLowerCase()}`;
  const [voted, setVoted] = useState<"up" | "down" | null>(() => {
    try {
      const v = localStorage.getItem(voteKey);
      return v === "up" || v === "down" ? v : null;
    } catch {
      return null;
    }
  });

  const feedbackMutation = useMutation({
    mutationFn: async (vote: "up" | "down") => {
      const res = await apiRequest("POST", "/api/restaurants/feedback", {
        placeId: restaurant.placeId,
        dishName: recommendation.dishName,
        vote,
      });
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: (_data, vote) => {
      setVoted(vote);
      try {
        localStorage.setItem(voteKey, vote);
      } catch {
        // Private browsing — vote still counted server-side.
      }
      toast({
        title: vote === "up" ? "Glad it hit the spot!" : "Thanks for the heads up",
        description:
          vote === "up"
            ? "Your vote helps keep this pick on top."
            : "Enough reports like yours and we'll re-research this restaurant.",
      });
    },
    onError: () => {
      toast({ title: "Couldn't record that", description: "Please try again.", variant: "destructive" });
    },
  });

  const confidence = CONFIDENCE_META[recommendation.confidence] ?? CONFIDENCE_META.low;
  const ConfidenceIcon = confidence.icon;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          data-testid="back-button"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to restaurants
        </button>
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-muted-foreground">{restaurant.name}</span>
        </div>
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Order This One</p>
          <h1 className="text-2xl font-bold text-foreground leading-tight" data-testid="dish-name">
            {recommendation.dishName}
          </h1>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Badge variant="outline" className={`text-xs font-medium gap-1 ${confidence.className}`} data-testid="confidence-badge">
              <ConfidenceIcon className="w-3 h-3" />
              {confidence.label}
            </Badge>
            {recommendation.priceRange && recommendation.priceRange !== "unknown" && (
              <Badge variant="outline" className="text-xs font-medium">
                {recommendation.priceRange}
              </Badge>
            )}
            {recommendation.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs font-medium">
                {tag}
              </Badge>
            ))}
          </div>

          {recommendation.photoNames && recommendation.photoNames.length > 0 && (
            <PhotoGallery photoNames={recommendation.photoNames} alt={`${restaurant.name} photos`} />
          )}

          <p className="text-base text-foreground/80 mt-4 leading-relaxed">{recommendation.description}</p>

          <Card className="mt-5 p-4 border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Why this dish?</p>
                <p className="text-sm text-foreground/70 mt-1 leading-relaxed">{recommendation.whyThisOne}</p>
                {recommendation.confidenceReason && (
                  <p className="text-xs text-muted-foreground mt-2">{recommendation.confidenceReason}</p>
                )}
              </div>
            </div>
          </Card>

          {recommendation.evidence.length > 0 && (
            <div className="mt-6" data-testid="evidence-section">
              <p className="text-sm font-semibold text-foreground mb-2">What people say</p>
              <div className="space-y-2">
                {recommendation.evidence.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/50">
                    <Quote className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground/80 leading-relaxed">“{ev.quote}”</p>
                      <p className="text-xs text-muted-foreground mt-1">— {ev.source}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recommendation.runnersUp.length > 0 && (
            <div className="mt-6" data-testid="runners-up-section">
              <p className="text-sm font-semibold text-foreground mb-2">Also in the running</p>
              <div className="space-y-1.5">
                {recommendation.runnersUp.map((ru, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Utensils className="w-3.5 h-3.5 text-muted-foreground mt-1 shrink-0" />
                    <p className="text-foreground/70">
                      <span className="font-medium text-foreground">{ru.dishName}</span>
                      {" — "}
                      {ru.note}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recommendation.citations.length > 0 && (
            <div className="mt-6" data-testid="citations-section">
              <p className="text-sm font-semibold text-foreground mb-2">Sources</p>
              <div className="space-y-1">
                {recommendation.citations.map((c, i) => (
                  <a
                    key={i}
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline truncate"
                  >
                    <LinkIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{c.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <Card className="mt-6 p-4">
            <p className="text-sm font-semibold text-foreground">Been here? Was this the right call?</p>
            <div className="flex gap-2 mt-3">
              <Button
                variant={voted === "up" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                disabled={voted !== null || feedbackMutation.isPending}
                onClick={() => feedbackMutation.mutate("up")}
                data-testid="feedback-up"
              >
                <ThumbsUp className="w-4 h-4 mr-1.5" />
                Nailed it
              </Button>
              <Button
                variant={voted === "down" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                disabled={voted !== null || feedbackMutation.isPending}
                onClick={() => feedbackMutation.mutate("down")}
                data-testid="feedback-down"
              >
                <ThumbsDown className="w-4 h-4 mr-1.5" />
                Wrong pick
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Votes feed back into the research — repeated "wrong pick" reports trigger a fresh deep-dive.
            </p>
          </Card>

          <Button className="w-full mt-6" size="lg" onClick={onBack} data-testid="try-another">
            <Utensils className="w-4 h-4 mr-2" />
            Try Another Restaurant
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { toast } = useToast();
  const [appState, setAppState] = useState<AppState>("locating");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantResult | null>(null);
  const [recommendation, setRecommendation] = useState<DishRecommendation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [manualLocation, setManualLocation] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [restaurantSearch, setRestaurantSearch] = useState("");
  const [predictions, setPredictions] = useState<AutocompletePrediction[]>([]);
  const [showPredictions, setShowPredictions] = useState(false);
  const [isSearchingRestaurant, setIsSearchingRestaurant] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  // Invalidates in-flight autocomplete responses when the input changes/clears.
  const searchSeqRef = useRef(0);
  // Google Places autocomplete billing session; closed by the details call.
  const sessionTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowPredictions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    searchSeqRef.current += 1;
    const seq = searchSeqRef.current;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!restaurantSearch.trim()) {
      setPredictions([]);
      setShowPredictions(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : Math.random().toString(36).slice(2);
        }
        let url = `/api/restaurants/autocomplete?input=${encodeURIComponent(restaurantSearch.trim())}&session=${sessionTokenRef.current}`;
        if (coords) {
          url += `&lat=${coords.lat}&lng=${coords.lng}`;
        }
        const res = await apiRequest("GET", url);
        const data = (await res.json()) as { predictions?: AutocompletePrediction[] };
        if (seq !== searchSeqRef.current) return; // stale response — input changed
        setPredictions(data.predictions || []);
        setShowPredictions(true);
      } catch {
        if (seq === searchSeqRef.current) setPredictions([]);
      }
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [restaurantSearch, coords]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError("manual");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationLabel("Near you");
        setAppState("browse");
      },
      () => {
        setLocationError("manual");
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }, []);

  const handleManualSearch = useCallback(async () => {
    if (!manualLocation.trim()) return;
    setIsGeocoding(true);
    try {
      const res = await apiRequest("GET", `/api/geocode?address=${encodeURIComponent(manualLocation.trim())}`);
      const data = (await res.json()) as { lat: number; lng: number; formatted: string };
      setCoords({ lat: data.lat, lng: data.lng });
      setLocationLabel(data.formatted);
      setLocationError(null);
      setAppState("browse");
    } catch {
      setLocationError("not_found");
    } finally {
      setIsGeocoding(false);
    }
  }, [manualLocation]);

  const {
    data: restaurantsData,
    isLoading: isLoadingRestaurants,
    isError: isRestaurantsError,
    refetch: refetchRestaurants,
  } = useQuery<{ restaurants: RestaurantResult[] }>({
    queryKey: ["/api/restaurants/nearby", coords?.lat, coords?.lng],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/restaurants/nearby?lat=${coords!.lat}&lng=${coords!.lng}&radius=1500`
      );
      return (await res.json()) as { restaurants: RestaurantResult[] };
    },
    enabled: !!coords,
  });

  const restaurants = restaurantsData?.restaurants || [];

  const recommendMutation = useMutation({
    mutationFn: async (restaurant: RestaurantResult) => {
      const res = await apiRequest("POST", "/api/restaurants/recommend", {
        placeId: restaurant.placeId,
      });
      return (await res.json()) as { recommendation: DishRecommendation; cached: boolean };
    },
    onSuccess: (data, restaurant) => {
      // Pair the result with the restaurant this mutation was started for, so
      // an overlapping selection can never mismatch header and recommendation.
      setSelectedRestaurant(restaurant);
      setRecommendation(data.recommendation);
      setAppState("result");
    },
    onError: () => {
      toast({
        title: "Research failed",
        description: "Couldn't finish researching that restaurant. Give it another try.",
        variant: "destructive",
      });
      setAppState("browse");
    },
  });

  const selectionBusy = recommendMutation.isPending || isSearchingRestaurant;

  const handleSelectRestaurant = useCallback(
    (restaurant: RestaurantResult) => {
      if (selectionBusy) return;
      setSelectedRestaurant(restaurant);
      setAppState("loading-rec");
      recommendMutation.mutate(restaurant);
    },
    [recommendMutation, selectionBusy]
  );

  const handleSelectPrediction = useCallback(
    async (prediction: AutocompletePrediction) => {
      if (selectionBusy) return;
      setShowPredictions(false);
      setRestaurantSearch("");
      setIsSearchingRestaurant(true);
      try {
        const session = sessionTokenRef.current;
        let url = `/api/restaurants/details?placeId=${encodeURIComponent(prediction.placeId)}`;
        if (session) url += `&session=${session}`;
        sessionTokenRef.current = null; // the details call closes the billing session
        const res = await apiRequest("GET", url);
        const data = (await res.json()) as { restaurant: RestaurantResult };
        const restaurant: RestaurantResult = data.restaurant;
        setSelectedRestaurant(restaurant);
        setAppState("loading-rec");
        recommendMutation.mutate(restaurant);
      } catch {
        toast({
          title: "Couldn't load that restaurant",
          description: "Please try searching again.",
          variant: "destructive",
        });
      } finally {
        setIsSearchingRestaurant(false);
      }
    },
    [recommendMutation, toast, selectionBusy]
  );

  const handleBack = useCallback(() => {
    setSelectedRestaurant(null);
    setRecommendation(null);
    setAppState("browse");
  }, []);

  const priceSymbol = (level: number) => "$".repeat(level || 1);

  if (appState === "locating" && !locationError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-background">
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Navigation className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Finding you...</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Detecting your location to discover nearby restaurants
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (locationError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-background">
        <div className="flex flex-col items-center gap-6 text-center max-w-sm w-full">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <MapPin className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Where are you dining?</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Enter an address, neighborhood, or zip code
            </p>
          </div>
          <form
            className="w-full flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleManualSearch();
            }}
          >
            <Input
              value={manualLocation}
              onChange={(e) => setManualLocation(e.target.value)}
              placeholder="e.g. Deep Ellum, Dallas"
              className="flex-1"
              data-testid="location-input"
              autoFocus
            />
            <Button type="submit" disabled={isGeocoding || !manualLocation.trim()} data-testid="search-location">
              {isGeocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </form>
          {locationError === "not_found" && (
            <p className="text-xs text-destructive">Could not find that location. Try a different search.</p>
          )}
        </div>
      </div>
    );
  }

  if (appState === "result" && recommendation && selectedRestaurant) {
    return <ResultView restaurant={selectedRestaurant} recommendation={recommendation} onBack={handleBack} />;
  }

  if (appState === "loading-rec" && selectedRestaurant) {
    return <LoadingResearch restaurantName={selectedRestaurant.name} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-6">
        <header className="mb-6">
          <div className="flex items-center gap-2">
            <Utensils className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">Order This One</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Tap a restaurant to discover the one must-order dish — researched from reviews, Reddit, and food press.
          </p>
          {locationLabel && (
            <button
              onClick={() => {
                setCoords(null);
                setLocationError("manual");
                setLocationLabel(null);
                setManualLocation("");
              }}
              className="flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
              data-testid="change-location"
            >
              <MapPin className="w-3 h-3" />
              {locationLabel}
              <span className="text-muted-foreground ml-1">Change</span>
            </button>
          )}
        </header>

        <div ref={searchContainerRef} className="relative mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={restaurantSearch}
              onChange={(e) => setRestaurantSearch(e.target.value)}
              onFocus={() => {
                if (predictions.length > 0) setShowPredictions(true);
              }}
              placeholder="Search by restaurant name..."
              className="pl-9 pr-9"
              data-testid="restaurant-search-input"
            />
            {restaurantSearch && (
              <button
                onClick={() => {
                  setRestaurantSearch("");
                  setPredictions([]);
                  setShowPredictions(false);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {showPredictions && predictions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-lg overflow-hidden">
              {predictions.map((prediction) => (
                <button
                  key={prediction.placeId}
                  onClick={() => handleSelectPrediction(prediction)}
                  className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex items-start gap-3 border-b border-border last:border-b-0"
                  data-testid={`prediction-${prediction.placeId}`}
                >
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{prediction.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{prediction.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {isSearchingRestaurant && (
          <div className="flex items-center justify-center py-8 mb-4">
            <Loader2 className="w-5 h-5 animate-spin text-primary mr-2" />
            <span className="text-sm text-muted-foreground">Loading restaurant details...</span>
          </div>
        )}

        {isLoadingRestaurants ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : isRestaurantsError ? (
          <div className="text-center py-12" data-testid="nearby-error">
            <Utensils className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              Couldn't load nearby restaurants right now.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetchRestaurants()}>
              Try again
            </Button>
          </div>
        ) : restaurants.length === 0 ? (
          <div className="text-center py-12">
            <Utensils className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No restaurants found nearby. Try moving to a different area.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {restaurants.map((restaurant) => (
              <button
                key={restaurant.placeId}
                onClick={() => handleSelectRestaurant(restaurant)}
                className="w-full text-left p-3.5 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors flex items-center gap-3 group"
                data-testid={`restaurant-${restaurant.placeId}`}
              >
                {restaurant.photoName ? (
                  <img
                    src={photoUrl(restaurant.photoName)}
                    alt={restaurant.name}
                    className="w-14 h-14 rounded-lg object-cover shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Utensils className="w-6 h-6 text-muted-foreground/40" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {restaurant.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex items-center gap-0.5">
                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      <span className="text-xs font-medium text-foreground">
                        {restaurant.rating}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      ({restaurant.userRatingsTotal.toLocaleString()})
                    </span>
                    {restaurant.priceLevel > 0 && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground">
                          {priceSymbol(restaurant.priceLevel)}
                        </span>
                      </>
                    )}
                    {restaurant.openNow !== null && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className={`text-xs font-medium ${restaurant.openNow ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                          {restaurant.openNow ? "Open" : "Closed"}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {restaurant.vicinity}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
