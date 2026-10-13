/* eslint-disable react-refresh/only-export-components -- Browser tests mount this fixture imperatively. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../src/components/ui/accordion";
import { Button } from "../src/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../src/components/ui/dialog";
import { Progress } from "../src/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../src/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../src/components/ui/tooltip";

function MotionFixture() {
  const [value, setValue] = useState<number | null>(15);
  const [extra, setExtra] = useState(false);
  return (
    <div className="space-y-6 p-8">
      <Select defaultValue="one">
        <SelectTrigger aria-label="Fixture choice">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="one">First choice</SelectItem>
          <SelectItem value="two">Second choice</SelectItem>
        </SelectContent>
      </Select>
      <Dialog>
        <DialogTrigger render={<Button />}>Open fixture dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Fixture dialog</DialogTitle>
        </DialogContent>
      </Dialog>
      <TooltipProvider delay={100}>
        <div className="flex gap-2">
          {["First", "Second"].map((name) => (
            <Tooltip key={name}>
              <TooltipTrigger render={<Button />}>{name} trigger</TooltipTrigger>
              <TooltipContent>{name} tooltip</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <Accordion defaultValue={["models"]}>
        <AccordionItem value="models">
          <AccordionTrigger>Fixture models</AccordionTrigger>
          <AccordionContent>
            <p>Model details</p>
            <Button onClick={() => setExtra(!extra)}>Toggle extra details</Button>
            {extra && <div className="h-40">Additional model details</div>}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <Progress aria-label="Fixture progress" value={value} min={10} max={30} />
      <div className="flex gap-2">
        <Button onClick={() => setValue(25)}>Advance progress</Button>
        <Button onClick={() => setValue(100)}>Complete progress</Button>
        <Button onClick={() => setValue(null)}>Indeterminate progress</Button>
      </div>
    </div>
  );
}

export function mount() {
  document.querySelector<HTMLElement>("#root")!.style.display = "none";
  const container = document.createElement("div");
  container.id = "motion-fixture";
  document.body.appendChild(container);
  createRoot(container).render(<MotionFixture />);
}
