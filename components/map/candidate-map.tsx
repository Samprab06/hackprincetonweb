"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Map, { Layer, Marker, NavigationControl, Source, type ViewState, type MarkerInstance } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { catchmentRadiusMiles, competitors, getSiteFixture } from "../site/site-fixtures";

const initialView = { longitude: -95.396, latitude: 29.772, zoom: 11.4, bearing: 0, pitch: 0, padding: {top: 0, right: 0, bottom: 0, left: 0} };

function restoreView(key: string): ViewState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (saved && [saved.longitude, saved.latitude, saved.zoom].every(Number.isFinite)
      && Math.abs(saved.latitude) <= 85 && Math.abs(saved.longitude) <= 180 && saved.zoom >= 0 && saved.zoom <= 22) {
      return { ...initialView, longitude: saved.longitude, latitude: saved.latitude, zoom: saved.zoom };
    }
  } catch {}
  return initialView;
}

function catchment(longitude: number, latitude: number) {
  const latitudeRadius = catchmentRadiusMiles / 69;
  const longitudeRadius = latitudeRadius / Math.cos(latitude * Math.PI / 180);
  const points = Array.from({ length: 64 }, (_, index) => {
    const angle = 2 * Math.PI * index / 64;
    return [longitude + longitudeRadius * Math.cos(angle), latitude + latitudeRadius * Math.sin(angle)];
  });
  return [...points, points[0]];
}

type Site = { id: string; address: string; href: string };
type Overlay = "residents" | "workers";

function setSiteMarkerElement(marker: MarkerInstance | null) {
  if (!marker) return;
  const element = marker.getElement();
  // MapLibre supplies button semantics for unconfigured marker wrappers.
  // The link inside this wrapper is the site marker's only control.
  element.setAttribute("role", "presentation");
  element.setAttribute("aria-label", "");
}

export default function CandidateMap({ projectId, sites, selectedId }: { projectId: string; sites: Site[]; selectedId?: string }) {
  const key = `sitework:map:${projectId}`;
  const [view, setView] = useState(() => restoreView(key));
  const [overlay, setOverlay] = useState<Overlay>(() => {
    try { return sessionStorage.getItem(key + ":overlay") === "workers" ? "workers" : "residents"; }
    catch { return "residents"; }
  });
  const loaded = useRef(false);
  const [failed, setFailed] = useState(false);
  const selected = selectedId ? getSiteFixture(selectedId) : undefined;

  if (failed) return (
    <div className="rounded-lg bg-paper p-4">
      <p role="alert">The map is unavailable. Choose a candidate below.</p>
      <button type="button" className="mt-3 rounded bg-pine px-3 py-2 text-white" onClick={() => {
        loaded.current = false;
        setFailed(false);
      }}>Retry map</button>
    </div>
  );

  return (
    <>
      <label className="mb-3 flex items-center gap-2 text-sm font-medium">
        Catchment layer
        <select className="rounded border border-line px-2 py-1" value={overlay} onChange={(event) => {
          const next = event.target.value === "workers" ? "workers" : "residents";
          setOverlay(next);
          try { sessionStorage.setItem(key + ":overlay", next); } catch {}
        }}>
          <option value="residents">Residents</option><option value="workers">Workers</option>
        </select>
      </label>
      <Map {...view} style={{ width: "100%", height: 440 }} mapStyle="https://tiles.openfreemap.org/styles/liberty"
        onMove={({ viewState }) => setView(viewState)}
        onMoveEnd={({ viewState }) => {
          try { sessionStorage.setItem(key, JSON.stringify(viewState)); } catch {}
        }}
        onLoad={() => { loaded.current = true; }} onError={() => { if (!loaded.current) setFailed(true); }} dragRotate={false} touchPitch={false} maxPitch={0}>
        <NavigationControl showCompass={false} />
        {selected && (
          <Source id="catchment" type="geojson" data={{ type: "Feature", properties: {},
            geometry: { type: "Polygon", coordinates: [catchment(selected.longitude, selected.latitude)] } }}>
            <Layer id="catchment-fill" type="fill" paint={{ "fill-color": overlay === "residents" ? "#43a386" : "#7262bd", "fill-opacity": 0.23 }} />
            <Layer id="catchment-outline" type="line" paint={{ "line-color": "#1b4937", "line-width": 2 }} />
          </Source>
        )}
        {competitors.map((competitor) => (
          <Marker ref={(marker) => {
            const element = marker?.getElement();
            element?.setAttribute("role", "img");
            element?.setAttribute("aria-label", competitor.name);
          }} key={competitor.name} longitude={competitor.longitude} latitude={competitor.latitude}>
            <span title={competitor.name} className="block size-3 rounded-full border-2 border-white bg-orange-600 shadow" />
          </Marker>
        ))}
        {sites.map((site) => {
          const location = getSiteFixture(site.id);
          if (!location) return null;
          return (
            <Marker ref={setSiteMarkerElement} key={site.id} longitude={location.longitude} latitude={location.latitude}>
              <Link href={site.href} aria-label={`Open ${site.address}`} aria-current={site.id === selectedId || undefined} className="rounded-full border-2 border-white bg-pine px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white shadow aria-[current=true]:ring-4 aria-[current=true]:ring-amber-400">
                {site.address}
              </Link>
            </Marker>
          );
        })}
      </Map>
      <p className="mt-2 text-sm text-muted">
        Orange markers show example competitors.
        {selected && ` The ring contains an estimated ${selected[overlay].toLocaleString("en-US")} ${overlay} in this fixture.`}
      </p>
    </>
  );
}
