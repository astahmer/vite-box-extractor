import type { ThemeProps, WithStyledProps } from "@box-extractor/vanilla-wind";
import { PropsWithChildren, useState } from "react";
import "./App.css";
import { tw } from "./theme";

function App() {
    const className = tw({ display: "flex", color: "orange" });
    console.log({ className, another: tw({ color: "pink" }) }, "yes");

    const [state, setState] = useState(0);
    console.log(state);

    return (
        <div className={tw({ display: "flex", flexDirection: "column", height: "100%" })}>
            <div className={tw({ display: "flex", flexDirection: "column", height: "100%" })}>
                <div className={tw({ display: "flex", flexDirection: "column", margin: "auto" })}>
                    <div className={tw({ display: "flex", flexDirection: "column", justifyContent: "center" })}>
                        <span className={tw({ color: "blue.500" })}>yes</span>
                        <span onClick={() => setState((current) => current + 1)} className={tw({ color: "pink" })}>
                            class: ({className})
                        </span>
                        <Box color="red.200" fontSize="4xl">
                            boxboxbox
                        </Box>
                    </div>
                </div>
            </div>
        </div>
    );
}

const Box = (props: WithStyledProps<typeof tw> & PropsWithChildren) => {
    const { _styled, children, ...rest } = props as Omit<typeof props, keyof ThemeProps<typeof tw>>;
    return <div className={_styled}>{children}</div>;
};

export default App;
