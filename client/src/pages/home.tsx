import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  MapPin,
  Star,
  ChevronRight,
  ArrowLeft,
  Utensils,
  Flame,
  Loader2,
  Navigation,
  Search,
  Sparkles,
} from "lucide-react";
import type { RestaurantResult, DishRecommendation } from "@shared/schema";

type AppState = "locating" | "browse" | "loading-rec" | "result";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("locating");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantResult | null>(null);
  const [recommendation, setRecommendation] = useState<DishRecommendation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [manualLocation, setManualLocation] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);

  // Get user location
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
      const data = await res.json();
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

  // Fetch nearby restaurants
  const {
    data: restaurantsData,
    isLoading: isLoadingRestaurants,
  } = useQuery<{ restaurants: RestaurantResult[] }>({
    queryKey: ["/api/restaurants/nearby", coords?.lat, coords?.lng],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/restaurants/nearby?lat=${coords!.lat}&lng=${coords!.lng}&radius=1500`
      );
      return res.json();
    },
    enabled: !!coords,
  });

  const restaurants = restaurantsData?.restaurants || [];

  // Get recommendation mutation
  const recommendMutation = useMutation({
    mutationFn: async (restaurant: RestaurantResult) => {
      const res = await apiRequest("POST", "/api/restaurants/recommend", {
        placeId: restaurant.placeId,
        restaurantName: restaurant.name,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setRecommendation(data.recommendation);
      setAppState("result");
    },
    onError: () => {
      setAppState("browse");
    },
  });

  const handleSelectRestaurant = useCallback(
    (restaurant: RestaurantResult) => {
      setSelectedRestaurant(restaurant);
      setAppState("loading-rec");
      recommendMutation.mutate(restaurant);
    },
    [recommendMutation]
  );

  const handleBack = useCallback(() => {
    setSelectedRestaurant(null);
    setRecommendation(null);
    setAppState("browse");
  }, []);

  const priceSymbol = (level: number) => "$".repeat(level || 1);

  // Locating state
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

  // Location error / manual entry
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

  // Result screen
  if (appState === "result" && recommendation && selectedRestaurant) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-lg mx-auto px-4 py-6">
          {/* Back button */}
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            data-testid="back-button"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to restaurants
          </button>

          {/* Restaurant context */}
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">
              {selectedRestaurant.name}
            </span>
          </div>

          {/* The recommendation */}
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">
              Order This One
            </p>
            <h1 className="text-2xl font-bold text-foreground leading-tight">
              {recommendation.dishName}
            </h1>

            <p className="text-base text-foreground/80 mt-4 leading-relaxed">
              {recommendation.description}
            </p>

            {/* Tags */}
            <div className="flex flex-wrap gap-2 mt-4">
              {recommendation.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs font-medium"
                >
                  {tag}
                </Badge>
              ))}
              {recommendation.priceRange && recommendation.priceRange !== "unknown" && (
                <Badge variant="outline" className="text-xs font-medium">
                  {recommendation.priceRange}
                </Badge>
              )}
            </div>

            {/* Why this one card */}
            <Card className="mt-6 p-4 border-primary/20 bg-primary/5">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Why this dish?</p>
                  <p className="text-sm text-foreground/70 mt-1 leading-relaxed">
                    {recommendation.whyThisOne}
                  </p>
                </div>
              </div>
            </Card>

            {/* Sources */}
            {recommendation.sources.length > 0 && (
              <p className="text-xs text-muted-foreground mt-4">
                Based on {recommendation.sources.join(", ").toLowerCase()}
              </p>
            )}

            {/* Action */}
            <Button
              className="w-full mt-6"
              size="lg"
              onClick={handleBack}
              data-testid="try-another"
            >
              <Utensils className="w-4 h-4 mr-2" />
              Try Another Restaurant
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Loading recommendation
  if (appState === "loading-rec" && selectedRestaurant) {
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
            <h1 className="text-xl font-bold text-foreground">
              Researching {selectedRestaurant.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Analyzing reviews to find the one dish you need to order...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Browse restaurants
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-2">
            <Utensils className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">Order This One</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Tap a restaurant to discover the one must-order dish.
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

        {/* Restaurant list */}
        {isLoadingRestaurants ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
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
                {/* Photo or placeholder */}
                {restaurant.photoRef ? (
                  <img
                    src={`/api/restaurants/photo?ref=${restaurant.photoRef}`}
                    alt={restaurant.name}
                    className="w-14 h-14 rounded-lg object-cover shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Utensils className="w-6 h-6 text-muted-foreground/40" />
                  </div>
                )}

                {/* Info */}
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

                {/* Arrow */}
                <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
