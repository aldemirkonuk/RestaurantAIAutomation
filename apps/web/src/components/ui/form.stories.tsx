import type { Meta, StoryObj } from '@storybook/react'
import { FormInput, FormTextarea, FormSelect, FormField, FormLabel, FormError, FormDescription, FormSection, FormActions } from './form'
import { Button } from '@wineops/ui'

const meta: Meta<typeof FormInput> = {
  title: 'UI/Form',
  component: FormInput,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Form components with built-in validation and error display.',
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof FormInput>

export const Input: Story = {
  args: {
    label: 'Wine Name',
    placeholder: 'Enter wine name',
    required: true,
  },
}

export const InputWithError: Story = {
  args: {
    label: 'Wine Name',
    placeholder: 'Enter wine name',
    required: true,
    error: 'Wine name is required',
  },
}

export const InputWithDescription: Story = {
  args: {
    label: 'SKU Code',
    description: 'Enter the barcode or SKU identifier',
    placeholder: 'e.g., WINE-001',
  },
}

export const Textarea: Story = {
  render: () => (
    <FormTextarea
      label="Tasting Notes"
      placeholder="Describe the wine's characteristics..."
      rows={4}
    />
  ),
}

export const Select: Story = {
  render: () => (
    <FormSelect
      label="Wine Type"
      required
      options={[
        { value: '', label: 'Select type...' },
        { value: 'red', label: 'Red' },
        { value: 'white', label: 'White' },
        { value: 'rose', label: 'Rosé' },
        { value: 'sparkling', label: 'Sparkling' },
      ]}
    />
  ),
}

export const CompleteForm: Story = {
  render: () => (
    <div className="w-full max-w-2xl space-y-6 p-6 bg-white rounded-2xl">
      <FormSection
        title="Wine Information"
        description="Enter the basic details about the wine"
      >
        <FormInput
          label="Wine Name"
          placeholder="e.g., Château Margaux"
          required
        />

        <div className="grid grid-cols-2 gap-4">
          <FormInput
            label="Producer"
            placeholder="e.g., Château Margaux"
            required
          />
          <FormInput
            label="Vintage"
            type="number"
            placeholder="2018"
          />
        </div>

        <FormSelect
          label="Type"
          required
          options={[
            { value: '', label: 'Select type...' },
            { value: 'red', label: 'Red' },
            { value: 'white', label: 'White' },
            { value: 'rose', label: 'Rosé' },
            { value: 'sparkling', label: 'Sparkling' },
            { value: 'dessert', label: 'Dessert' },
          ]}
        />
      </FormSection>

      <FormSection
        title="Inventory Details"
        description="Set stock levels and pricing"
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput
            label="Quantity"
            type="number"
            placeholder="12"
            required
          />
          <FormInput
            label="Threshold"
            type="number"
            placeholder="6"
            description="Minimum stock before alert"
          />
        </div>

        <FormInput
          label="Price per Bottle"
          type="number"
          placeholder="85.00"
          required
        />
      </FormSection>

      <FormSection title="Additional Information">
        <FormTextarea
          label="Tasting Notes"
          placeholder="Describe the wine's characteristics..."
          rows={4}
        />
      </FormSection>

      <FormActions>
        <Button className="flex-1">Save Wine</Button>
        <Button variant="secondary">Cancel</Button>
      </FormActions>
    </div>
  ),
  parameters: {
    layout: 'fullscreen',
  },
}

export const FormWithErrors: Story = {
  render: () => (
    <div className="w-full max-w-lg space-y-4 p-6 bg-white rounded-2xl">
      <h2 className="text-xl font-bold mb-4">Form with Validation Errors</h2>
      
      <FormInput
        label="Wine Name"
        placeholder="Enter wine name"
        required
        error="Wine name is required"
      />

      <FormInput
        label="Price"
        type="number"
        placeholder="0.00"
        required
        error="Price must be greater than 0"
      />

      <FormSelect
        label="Type"
        required
        error="Please select a wine type"
        options={[
          { value: '', label: 'Select type...' },
          { value: 'red', label: 'Red' },
          { value: 'white', label: 'White' },
        ]}
      />

      <FormActions>
        <Button className="flex-1" disabled>
          Submit
        </Button>
      </FormActions>
    </div>
  ),
}

export const FormComponents: Story = {
  render: () => (
    <div className="w-full max-w-lg space-y-6 p-6 bg-white rounded-2xl">
      <h2 className="text-xl font-bold mb-4">Form Component Showcase</h2>
      
      <FormField>
        <FormLabel required>Field Label</FormLabel>
        <FormDescription>Helper text explaining this field</FormDescription>
        <input className="w-full px-4 py-2 border rounded-lg" placeholder="Input..." />
      </FormField>

      <FormField error="This field has an error">
        <FormLabel required>Field with Error</FormLabel>
        <input className="w-full px-4 py-2 border border-rose-300 bg-rose-50 rounded-lg" placeholder="Input..." />
      </FormField>

      <div>
        <FormLabel>Standalone Label</FormLabel>
        <input className="w-full px-4 py-2 border rounded-lg mt-2" />
      </div>

      <FormError>This is an error message</FormError>
      
      <FormDescription>This is a description or helper text</FormDescription>
    </div>
  ),
}
