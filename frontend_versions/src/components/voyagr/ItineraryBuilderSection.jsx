import React, { useMemo, useState } from "react";
import { BUILDER_ACTIVITY_POOL } from "./data";
import SectionHeader from "./SectionHeader";

function createEmptyDays(dayCount = 3) {
  return Array.from({ length: dayCount }, (_, index) => ({
    id: index + 1,
    items: [],
  }));
}

function makeScheduleItem(activity) {
  return {
    instanceId: `${activity.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ...activity,
  };
}

export default function ItineraryBuilderSection() {
  const [dayColumns, setDayColumns] = useState(() => createEmptyDays(3));
  const [dragPayload, setDragPayload] = useState(null);
  const [dragOverDayId, setDragOverDayId] = useState(null);

  const totalItems = useMemo(
    () =>
      dayColumns.reduce((count, dayColumn) => count + dayColumn.items.length, 0),
    [dayColumns]
  );

  const handleDropToDay = (targetDayId) => {
    if (!dragPayload) {
      return;
    }

    setDayColumns((previousColumns) => {
      const nextColumns = previousColumns.map((column) => ({
        ...column,
        items: [...column.items],
      }));

      if (dragPayload.type === "pool") {
        const targetColumn = nextColumns.find((column) => column.id === targetDayId);
        if (targetColumn) {
          targetColumn.items.push(makeScheduleItem(dragPayload.activity));
        }
      }

      if (dragPayload.type === "day") {
        const sourceColumn = nextColumns.find((column) => column.id === dragPayload.dayId);
        const targetColumn = nextColumns.find((column) => column.id === targetDayId);

        if (sourceColumn && targetColumn) {
          const [movedItem] = sourceColumn.items.splice(dragPayload.itemIndex, 1);
          if (movedItem) {
            targetColumn.items.push(movedItem);
          }
        }
      }

      console.debug("[voyagr-builder] activity dropped", {
        targetDayId,
        totalItems:
          nextColumns.reduce((count, dayColumn) => count + dayColumn.items.length, 0),
      });

      return nextColumns;
    });

    setDragPayload(null);
    setDragOverDayId(null);
  };

  return (
    <section id="builder" className="voy-section voy-builder">
      <SectionHeader
        eyebrow="Organise"
        title="Drag and Build Your"
        highlight="Itinerary"
        subtitle="Use drag and drop to shape a day-by-day plan before generating your final trip."
      />

      <div className="voy-builder-wrap">
        <div>
          <h3 className="voy-builder-heading">Activity Pool</h3>
          <div className="voy-activity-pool">
            {BUILDER_ACTIVITY_POOL.map((activity) => (
              <article
                key={activity.id}
                className="voy-activity-item"
                draggable
                onDragStart={() =>
                  setDragPayload({
                    type: "pool",
                    activity,
                  })
                }
              >
                <span>{activity.icon}</span>
                <strong>{activity.name}</strong>
                <small>{activity.duration}</small>
              </article>
            ))}
          </div>
        </div>

        <div>
          <h3 className="voy-builder-heading">Your Schedule ({totalItems})</h3>
          <div className="voy-day-columns">
            {dayColumns.map((dayColumn) => (
              <section
                key={dayColumn.id}
                className={`voy-day-column ${
                  dragOverDayId === dayColumn.id ? "drag-over" : ""
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverDayId(dayColumn.id);
                }}
                onDragLeave={() => setDragOverDayId(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDropToDay(dayColumn.id);
                }}
              >
                <header>
                  <h4>Day {dayColumn.id}</h4>
                  <button
                    type="button"
                    onClick={() =>
                      setDayColumns((previousColumns) =>
                        previousColumns.map((column) =>
                          column.id === dayColumn.id
                            ? { ...column, items: [] }
                            : column
                        )
                      )
                    }
                  >
                    Clear
                  </button>
                </header>

                <div className="voy-day-dropzone">
                  {dayColumn.items.length === 0 ? (
                    <p className="voy-day-empty">Drop activities here</p>
                  ) : (
                    dayColumn.items.map((item, itemIndex) => (
                      <article
                        key={item.instanceId}
                        className="voy-day-item"
                        draggable
                        onDragStart={() =>
                          setDragPayload({
                            type: "day",
                            dayId: dayColumn.id,
                            itemIndex,
                          })
                        }
                      >
                        <span>{item.icon}</span>
                        <strong>{item.name}</strong>
                        <small>{item.duration}</small>
                        <button
                          type="button"
                          onClick={() =>
                            setDayColumns((previousColumns) =>
                              previousColumns.map((column) => {
                                if (column.id !== dayColumn.id) {
                                  return column;
                                }

                                const nextItems = [...column.items];
                                nextItems.splice(itemIndex, 1);
                                return {
                                  ...column,
                                  items: nextItems,
                                };
                              })
                            )
                          }
                        >
                          ×
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
