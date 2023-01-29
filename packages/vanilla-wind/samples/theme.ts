import { defineProperties } from "../src/defineProperties";

const tokens = {
    colors: {
        "blue.50": "#ebf8ff",
        "blue.100": "#bee3f8",
        "blue.200": "#90cdf4",
        "blue.300": "#63b3ed",
        "blue.400": "#4299e1",
        "blue.500": "#3182ce",
        "blue.600": "#2b6cb0",
        "blue.700": "#2c5282",
        "blue.800": "#2a4365",
        "blue.900": "#1A365D",
        "red.50": "#FFF5F5",
        "red.100": "#FED7D7",
        "red.200": "#FEB2B2",
        "red.300": "#FC8181",
        "red.400": "#F56565",
        "red.500": "#E53E3E",
        "red.600": "#C53030",
        "red.700": "#9B2C2C",
        "red.800": "#822727",
        "red.900": "#63171B",
        "brand.50": "#F7FAFC",
        "brand.100": "#EFF6F8",
        "brand.200": "#D7E8EE",
        "brand.300": "#BFDAE4",
        "brand.400": "#90BFD0",
        "brand.500": "#60A3BC",
        "brand.600": "#5693A9",
        "brand.700": "#3A6271",
        "brand.800": "#2B4955",
        "brand.900": "#1D3138",
    },
    radii: {
        none: "0",
        sm: "0.125rem",
        base: "0.25rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
        full: "9999px",
    },
};

export const tw = defineProperties({
    conditions: {
        small: { selector: ".small &" },
        large: { selector: ".large &" },
        dark: { selector: ".dark &" },
        light: { selector: ".light &" },
        hover: { selector: "&:hover" },
    },
    defaultCondition: "small",
    properties: {
        display: true,
        color: tokens.colors,
        backgroundColor: tokens.colors,
        borderColor: tokens.colors,
        borderRadius: tokens.radii,
        padding: {
            4: "4px",
            8: "8px",
            12: "12px",
            16: "16px",
            20: "20px",
            24: "24px",
        },
        width: {
            "1/2": "50%",
        },
    },
    shorthands: {
        d: ["display"],
        w: ["width"],
        bg: ["backgroundColor"],
        p: ["padding"],
        rounded: ["borderRadius"],
    },
});