import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: any[]) => toastSpy(...a) }));
vi.mock("@/lib/mapboxToken", () => ({ getMapboxTokenSync: () => "pk.test", getMapboxToken: async () => "pk.test" }));
let pickerProps: any = null;
vi.mock("@/components/LocationPicker", () => ({
  default: (p: any) => { pickerProps = p; return <div data-testid="picker" />; },
}));
import AddressMapField, { staticMapUrl } from "./AddressMapField";

describe("AddressMapField", () => {
  it("shows a pin thumbnail when coordinates exist", () => {
    render(<AddressMapField label="Address" value="2 Thompson Street, Strand" lat={-34.1} lng={18.8} onSave={vi.fn()} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe(staticMapUrl("pk.test", -34.1, 18.8));
  });
  it("dragging the pin fills the address and Save writes address + coordinates", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AddressMapField label="Address" value="Address pending — WhatsApp confirmation sent" lat={-34.1} lng={18.8} onSave={onSave} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    await screen.findByTestId("picker");
    pickerProps.onLocationChange(-33.83, 18.64, "10a Gladstone Street, Durbanville", "drag");
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("10a Gladstone Street, Durbanville"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ address: "10a Gladstone Street, Durbanville", lat: -33.83, lng: 18.64 }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: "Address saved", description: "Map pin updated" }));
  });
  it("typing only (pin unchanged) saves just the address", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AddressMapField label="Address" value="" lat={-34.1} lng={18.8} onSave={onSave} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    await screen.findByTestId("picker");
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "5 Main Rd" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ address: "5 Main Rd", lat: null, lng: null }));
  });
});
