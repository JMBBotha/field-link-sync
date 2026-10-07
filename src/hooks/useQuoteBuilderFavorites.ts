import { useQuoteFavourites } from "./useQuoteFavourites";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

export function useQuoteBuilderFavorites(_products: PaletteProduct[]) {
  const { ids: favorites, toggle: toggleFavorite } = useQuoteFavourites();
  return { favorites, toggleFavorite };
}
