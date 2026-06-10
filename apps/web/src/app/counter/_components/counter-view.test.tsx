
import { render, screen, fireEvent } from "@testing-library/react";
import CounterView from "../counter-view";
import "@testing-library/jest-dom";

describe("CounterView", () => {
  // Mock localStorage
  const localStorageMock = (() => {
    let store: { [key: string]: string } = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      clear: () => {
        store = {};
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };
  })();

  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
  });

  beforeEach(() => {
    localStorageMock.clear();
  });

  it("should render with initial count of 0", () => {
    render(<CounterView />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("should increment count on button click", () => {
    render(<CounterView />);
    fireEvent.click(screen.getByText("Incrementar"));
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("should decrement count on button click", () => {
    render(<CounterView />);
    fireEvent.click(screen.getByText("Incrementar"));
    fireEvent.click(screen.getByText("Decrementar"));
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("should not decrement below 0", () => {
    render(<CounterView />);
    fireEvent.click(screen.getByText("Decrementar"));
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("should reset count on button click", () => {
    render(<CounterView />);
    fireEvent.click(screen.getByText("Incrementar"));
    fireEvent.click(screen.getByText("Incrementar"));
    fireEvent.click(screen.getByText("Resetear"));
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("should load count from localStorage", () => {
    localStorageMock.setItem("simple-counter-value", "5");
    render(<CounterView />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("should save count to localStorage", () => {
    render(<CounterView />);
    fireEvent.click(screen.getByText("Incrementar"));
    expect(localStorageMock.getItem("simple-counter-value")).toBe("1");
  });
});
