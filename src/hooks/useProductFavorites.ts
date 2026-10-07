import { useQuoteFavourites } from "./useQuoteFavourites";

export function useProductFavorites() {
  const { ids: favorites, toggle: toggleFavorite } = useQuoteFavourites();
  return { favorites, toggleFavorite };
}
