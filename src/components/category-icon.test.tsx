import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryIcon } from "@/components/category-icon";

describe("CategoryIcon", () => {
  it("hides decorative icons from assistive technology", () => {
    render(<CategoryIcon iconKey="bottle" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("falls back for administrator-defined icon keys", () => {
    const { container } = render(<CategoryIcon iconKey="unknown" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
